// lib/scrape-utils.js

var zlib = require('zlib');

var request = require('request');

var downloader = require('jul11co-wdt').Downloader;

function requestWithEncoding(options, callback) {
  var req_err = null;
  try {
    var req = request.get(options);

    req.on('response', function(res) {
      var chunks = [];

      res.on('data', function(chunk) {
        chunks.push(chunk);
      });

      res.on('end', function() {
        if (!req_err) {
          var buffer = Buffer.concat(chunks);
          var encoding = res.headers['content-encoding'];
          if (encoding == 'gzip') {
            zlib.gunzip(buffer, function(err, decoded) {
              callback(err, res, decoded && decoded.toString());
            });
          } else if (encoding == 'deflate') {
            zlib.inflate(buffer, function(err, decoded) {
              callback(err, res, decoded && decoded.toString());
            })
          } else {
            callback(null, res, buffer.toString());
          }
        }
      });
    });

    req.on('error', function(err) {
      if (!req_err) {
        req_err = err;
        callback(err);
      }
    });
  } catch(e) {
    if (!req_err) {
      req_err = e;
      callback(e);
    }
  }
}

var downloadHtml = function(url, options, attempts, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
    attempts = 0;
  }
  if (typeof attempts == 'function') {
    callback = attempts;
    attempts = 0;
  }

  var request_url = url;
  if (options.html_proxy && options.html_proxy != '') {
    request_url = options.html_proxy + '?url=' + encodeURIComponent(request_url);
  }
  var request_options = {
    url: request_url,
    headers: options.request_headers || {
      'User-Agent': options.user_agent || 'request'
    },
    timeout: options.request_timeout || 60000 /* 60 seconds */
  };
  requestWithEncoding(request_options, function(error, response, html) {
    if (error) {
      // console.log(error);
      attempts++;
      if (error.code == "ESOCKETTIMEDOUT" || error.code == "ETIMEDOUT" || error.code == "ECONNRESET") {
        var max_attempts = options.max_attempts || 5;
        var backoff_delay = options.backoff_delay || 5000; // 5 seconds
        if (attempts < max_attempts) {
          if (options.verbose) console.log('Timeout! Retrying... (' + attempts + ')');
          setTimeout(function() {
            downloadHtml(url, options, attempts, callback);
          }, backoff_delay);
          return;
        }
      }
      return callback(error);
    }

    if (response.statusCode != 200) {
      return callback(new Error('Request failed with status code ' + response.statusCode));
    }

    var result = {
      requested_url: url,
      resolved_url: response.request.href,
      html: html
    };

    var content_type = response.headers['content-type'];
    if (content_type && content_type.indexOf('html') == -1) {
      // console.log(response.headers);
      result.headers = response.headers;
      return callback(new Error('Not HTML page (' + content_type + ')'), result);
    }

    return callback(null, result);
  });
}

module.exports = {
  downloadHtml: downloadHtml
};
