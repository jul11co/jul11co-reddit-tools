// lib/gfycat-scraper.js

var fs = require('fs');

var cheerio = require('cheerio');

var downloader = require('jul11co-wdt').Downloader;

exports.scrape = function(gfycat_url, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }
  
  if (options.verbose) console.log('Scrape:', gfycat_url);

  downloader.downloadHtml(gfycat_url, options, function(err, result) {
    if (err) return callback(err);
    if (!result || !result.html) return callback(new Error('Cannot download HTML'));

    var $ = cheerio.load(result.html);
    
    // fs.writeFileSync(__dirname + '/index.html', result.html, 'utf8');

    var page = {
      url: result.resolved_url || gfycat_url,
      gfycat: {}
    };

    if ($('figure.video-figure').length) {
      // format: mp4
      if ($('figure.video-figure amp-video source#mp4Source').length) {
        page.gfycat.mp4 = $('figure.video-figure amp-video source#mp4Source').attr('src')
      } 
      // format: webm
      if ($('figure.video-figure amp-video source#webmSource').length) {
        page.gfycat.webm = $('figure.video-figure amp-video source#webmSource').attr('src');
      }
      // format: gif
      if ($('figure.video-figure amp-video amp-img').length) {
        page.gfycat.gif = $('figure.video-figure amp-video amp-img').attr('src');
      }
    }

    if ($('#main-container amp-video').length) {
      // format: mp4
      if ($('#main-container amp-video source#mp4Source').length) {
        page.gfycat.mp4 = $('#main-container amp-video source#mp4Source').attr('src')
      } 
      // format: webm
      if ($('#main-container amp-video source#webmSource').length) {
        page.gfycat.webm = $('#main-container amp-video source#webmSource').attr('src');
      }
      // format: gif
      if ($('#main-container amp-video').find('amp-img').length) {
        page.gfycat.gif = $('#main-container amp-video').find('amp-img').attr('src');
      }
    }

    if ($('.detail-player .video-player-container').length) {
      // format: mp4
      if ($('section.detail-player .video-player-container video source[type="video/mp4"]').length) {
        page.gfycat.mp4 = $('section.detail-player .video-player-container video source[type="video/mp4"]').attr('src')
      } 
      // format: webm
      if ($('section.detail-player .video-player-container video source[type="video/webm"]').length) {
        page.gfycat.webm = $('section.detail-player .video-player-container video source[type="video/webm"]').attr('src');
      }
      // format: gif
      if ($('section.detail-player .video-player-container video img').length) {
        page.gfycat.gif = $('section.detail-player .video-player-container video img').attr('src');
      }
    }

    return callback(null, page);
  });
}
