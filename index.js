var toHTML = require('directory-index-html')
var pump = require('pump')
var mime = require('mime')
var range = require('range-parser')
var qs = require('querystring')

module.exports = serve

function serve (archive) {
  return onrequest

  function onfile (name, opts, req, res) {
    archive.stat(name, function (err, st) {
      if (err) return onerror(res, 404, err)

      var r = req.headers.range && range(st.size, req.headers.range)[0]
      res.setHeader('Accept-Ranges', 'bytes')
      res.setHeader('Content-Type', mime.lookup(name))

      if (r) {
        res.statusCode = 206
        res.setHeader('Content-Range', 'bytes ' + r.start + '-' + r.end + '/' + st.size)
        res.setHeader('Content-Length', r.end - r.start + 1)
      } else {
        res.setHeader('Content-Length', st.size)
      }

      if (req.method === 'HEAD') return res.end()
      pump(archive.createReadStream(name, r), res)
    })
  }

  function ondirectory (name, opts, req, res) {
    archive.stat(name + 'index.html', function (err) {
      if (err) return ondirectoryindex(name, opts, req, res)
      onfile(name + 'index.html', opts, req, res)
    })
  }

  function ondirectoryindex (name, opts, req, res) {
    list(archive, name, function (err, entries) {
      if (err) entries = []

      var wait = archive.metadata ? archive.metadata.length + 1 : 0
      var script = `
        var xhr = new XMLHttpRequest()
        xhr.open("GET", "${name}?wait=${wait}", true)
        xhr.onload = function () {
          document.open()
          document.write(xhr.responseText)
          document.close()
        }
        xhr.send(null)
      `

      var html = toHTML({directory: name, script: script}, entries)
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Content-Length', Buffer.byteLength(html))
      res.end(html)
    })
  }

  function onrequest (req, res) {
    var name = req.url.split('?')[0]
    var query = qs.parse(req.url.split('?')[1] || '')

    var wait = query.wait && Number(query.wait.toString()) || 0
    var have = archive.metadata ? archive.metadata.length : -1

    if (wait <= have) return ready()
    waitFor(archive, wait, ready)

    function ready () {
      if (name[name.length - 1] === '/') ondirectory(name, query, req, res)
      else onfile(name, query, req, res)
    }
  }
}

function waitFor (archive, until, cb) { // this feels a bit hacky, TODO: make less complicated?
  archive.setMaxListeners(0)
  if (!archive.metadata) archive.once('ready', waitFor.bind(null, archive, until, cb))
  if (archive.metadata.length >= until) return cb()
  archive.metadata.setMaxListeners(0)
  archive.metadata.once('append', waitFor.bind(null, archive, until, cb))
}

function onerror (res, status, err) {
  res.statusCode = status
  res.end(err.stack)
}

function list (archive, name, cb) {
  archive.readdir(name, function (err, names) {
    if (err) return cb(err)

    var error = null
    var missing = names.length
    var entries = []

    if (!missing) return cb(null, [])
    for (var i = 0; i < names.length; i++) stat(name + names[i], names[i])

    function stat (name, base) {
      archive.stat(name, function (err, st) {
        if (err) error = err

        if (st) {
          entries.push({
            type: st.isDirectory() ? 'directory' : 'file',
            name: base,
            size: st.size,
            mtime: st.mtime
          })
        }

        if (--missing) return
        if (error) return cb(error)
        cb(null, entries.sort(sort))
      })
    }
  })
}

function sort (a, b) {
  return a.name.localeCompare(b.name)
}
