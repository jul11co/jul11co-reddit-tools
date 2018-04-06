// lib/imgur-scraper.js

var fs = require('fs');

var cheerio = require('cheerio');

var utils = require('jul11co-utils');
var downloader = require('jul11co-wdt').Downloader;

var scrapeUtils = require('./scrape-utils');

function extractSubstring(original, prefix, suffix) {
  if (!original) return '';
  var tmp = original.substring(original.indexOf(prefix) + prefix.length);
  tmp = tmp.substring(0, tmp.indexOf(suffix));
  return tmp;
}

exports.scrape = function(imgur_url, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }
  
  if (options.verbose) console.log('Scrape:', imgur_url);

  scrapeUtils.downloadHtml(imgur_url, options, function(err, result) {
    if (err) {
      if (result && result.headers && result.headers['content-type'] 
        && result.headers['content-type'].indexOf('image/') == 0) {
        var page = {
          url: result.resolved_url || imgur_url,
          images: []
        };
        page.images.push({src: page.url});
        return callback(null, page); 
      }
      console.log(err);
      return callback(err);
    }

    if (!result || !result.html) return callback(new Error('Cannot download HTML'));

    var $ = cheerio.load(result.html);
    
    // fs.writeFileSync(__dirname + '/index.html', result.html, 'utf8');

    var page = {
      url: result.resolved_url || imgur_url
    };

    if (/imgur\.com\/gallery\//g.test(page.url)) {
      var gallery_id = page.url.replace('https://imgur.com/gallery/', '');
      gallery_id = gallery_id.replace('http://imgur.com/gallery/', '');
      options.gallery_url = page.url;

      if (options.verbose) console.log('Gallery ID: ' + gallery_id); 

      return exports.scrape('https://imgur.com/a/' + gallery_id + '/layout/blog', options, callback);
    }
    else if (/imgur\.com\/t\//g.test(page.url)) {
      var gallery_id = path.basename(page.url);
      options.gallery_url = page.url;

      if (options.verbose) console.log('Gallery ID: ' + gallery_id);

      return exports.scrape('https://imgur.com/a/' + gallery_id + '/layout/blog', options, callback);
    }

    if ($('.post-title').length) {
      page.post_title = $('.post-title').text().trim();
    }

    if ($('.post-title-meta').length) {
      page.post_account = $('.post-title-meta .post-account').text().trim();
      page.post_time = $('.post-title-meta span').last().attr('title');
    }

    var script = $('script').text();
    
    var galleryData = extractSubstring(script, 'window.runSlots = {', '};');
    galleryData = '{' + galleryData + '}';

    galleryData = utils.replaceAll(galleryData, "_config:", "\"_config\":");
    galleryData = utils.replaceAll(galleryData, "_place:", "\"_place\":");
    galleryData = utils.replaceAll(galleryData, "_item:", "\"_item\":");

    galleryData = utils.replaceAll(galleryData, "config:", "\"_config\":");
    galleryData = utils.replaceAll(galleryData, "place:", "\"_place\":");
    galleryData = utils.replaceAll(galleryData, "item:", "\"_item\":");

    // console.log(galleryData);

    var galleryDataObj;
    try {
      galleryDataObj = JSON.parse(galleryData);
    } catch(e) {
      // console.log(e);
      // return callback(e);
    }

    if (galleryDataObj && galleryDataObj._item) {
      // if (options.verbose) console.log('Gallery data');

      var post_title = galleryDataObj._item.title || page.post_title || page.title;

      var post_images = [];
      if (galleryDataObj._item.album_images && galleryDataObj._item.album_images 
        && galleryDataObj._item.album_images.images) {

        for (var i = 0; i < galleryDataObj._item.album_images.images.length; i++) {
          var image_data = galleryDataObj._item.album_images.images[i];
          post_images.push({
            hash: image_data.hash,
            ext: image_data.ext.split('?')[0],
            title: image_data.title,
            desc: image_data.description,
            width: image_data.width,
            height: image_data.height,
            size: image_data.size,
            datetime: image_data.datetime
          });
        }
        if (options.verbose) console.log(post_images);

        var images = [];
        post_images.forEach(function(post_image) {
          images.push({
            src: 'https://i.imgur.com/' + post_image.hash + post_image.ext,
            file: post_image.hash + post_image.ext,
          });
        });
        if (options.verbose) console.log(images.length + ' images');
        if (options.debug) console.log(images);

        page.images = images;
        
      } else if (galleryDataObj._item.hash /*&& galleryDataObj._item.mimetype*/ 
        && galleryDataObj._item.ext) {
        // if (options.verbose) console.log('Single image');

        post_images.push({
          src: 'http://i.imgur.com/' + galleryDataObj._item.hash + galleryDataObj._item.ext,
          file: galleryDataObj._item.hash + galleryDataObj._item.ext
        });
        if (options.verbose) console.log(post_images.length + ' images');
        if (options.debug) console.log(post_images);

        page.images = post_images;
      }

      return callback(null, page); 
    } else if ($('.post-images').length) {

      var post_images = [];

      $('.post-images .post-image-container').each(function() {
        var $post_image = $(this).find('.post-image');
        var $post_image_meta = $(this).find('.post-image-meta');

        var img_src = $post_image.find('img').first().attr('src');
        if (img_src && img_src != '') {
          post_images.push({
            src: img_src,
            desc: $post_image_meta.find('.post-image-description').text().trim()
          });
        }
      });

      var images = [];
      post_images.forEach(function(post_image) {
        images.push({
          src: post_image.src,
          alt: post_image.desc,
        });
      });
      if (options.verbose) console.log(images.length + ' images');
      if (options.debug) console.log(images);

      page.images = images;

      return callback(null, page); 
    } else {
      return callback(null, page);
    }
  });
}
