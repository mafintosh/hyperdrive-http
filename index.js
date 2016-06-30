var pump = require('pump')
var TimeoutStream = require('through-timeout')
var cbTimeout = require('callback-timeout')
var mime = require('mime')
var rangeParser = require('range-parser')
var JSONStream = require('JSONStream')

module.exports = HyperdriveHttp

function HyperdriveHttp (getArchive) {
  var singleArchive = false
  if (typeof (getArchive) !== 'function') {
    var archive = getArchive
    singleArchive = true
    getArchive = function (datUrl, cb) {
      cb(null, archive)
    }
  }
  var onrequest = function (req, res) {
    var datUrl = parse(req.url)
    if (!datUrl) return onerror(404, res)
    getArchive(datUrl, function (err, archive) {
      if (err) return onerror(err)
      archiveResponse(datUrl, archive, req, res)
    })
  }

  return onrequest

  function parse (url) {
    var key = url.slice(1, 65)
    var filename = url.slice(66)
    if (!/^[0-9a-f]{64}$/.test(key) && !singleArchive) return null
    else if (singleArchive) filename = url.slice(1)

    return {
      key: key,
      filename: filename
    }
  }
}

function archiveResponse (datUrl, archive, req, res) {
  if (!archive) onerror(404, res)

  if (!datUrl.filename) {
    var src = archive.list({live: false})
    var timeout = TimeoutStream({
      objectMode: true,
      duration: 10000
    }, () => {
      onerror(404, res)
      src.destroy()
    })
    var stringify = JSONStream.stringify('[', ',', ']\n', 2)
    pump(src, timeout, stringify, res)
  }

  archive.get(datUrl.filename, cbTimeout((err, entry) => {
    if (err && err.code === 'ETIMEOUT') return onerror(404, res)
    if (err || !entry || entry.type !== 'file') return onerror(404, res)

    var range = req.headers.range && rangeParser(entry.length, req.headers.range)[0]

    res.setHeader('Access-Ranges', 'bytes')
    res.setHeader('Content-Type', mime.lookup(datUrl.filename))

    if (!range || range < 0) {
      res.setHeader('Content-Length', entry.length)
      if (req.method === 'HEAD') return res.end()
      pump(archive.createFileReadStream(entry), res)
    } else {
      res.statusCode = 206
      res.setHeader('Content-Length', range.end - range.start + 1)
      res.setHeader('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + entry.length)
      if (req.method === 'HEAD') return res.end()
      pump(archive.createFileReadStream(entry, {start: range.start, end: range.end + 1}), res)
    }
  }, 10000))
}

function onerror (status, res) {
  res.statusCode = status
  res.end()
}