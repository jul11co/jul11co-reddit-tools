// lib/subreddit-link-extractor.js

var fs = require('fs');
var urlutil = require('url');

var cheerio = require('cheerio');

var downloader = require('jul11co-wdt').Downloader;

function urlGetHost(_url) {
  if (!_url || _url == '') return '';
  var host_url = '';
  var url_obj = urlutil.parse(_url);
  if (url_obj.slashes) {
    host_url = url_obj.protocol + '//' + url_obj.host;
  } else {
    host_url = url_obj.protocol + url_obj.host;
  }
  return host_url;
}

function isValidLink(link_href) {
  if (!link_href || link_href === '') return false;
  if (link_href.indexOf('#') == 0 
    || link_href.indexOf('mailto:') >= 0 
    || link_href.indexOf('javascript:') == 0
    || link_href.indexOf('data:') == 0) {
    return false;
  }
  return true;
}

var fixLinks = function($, page_info, options) {
  options = options || {};

  var page_host_url = urlGetHost(page_info.url);
  var page_host_url_obj = urlutil.parse(page_host_url);
  var page_url_obj = urlutil.parse(page_info.base_url || page_info.url);

  $('body a').each(function(){
    var link_href = $(this).attr('href');
    var link_title = $(this).text().trim();
    if (!isValidLink(link_href)) return;

    var link_url = link_href;
    link_url = link_url.replace('http:///', '/');
    if (link_url.indexOf('//') == 0) {
      link_url = page_host_url_obj.protocol + link_url;
    }

    var link_url_obj = urlutil.parse(link_url);
    if (!link_url_obj.host) {
      if (link_url.indexOf('/') == 0) {
        link_url = urlutil.resolve(page_host_url_obj, link_url_obj);
      } else {
        link_url = urlutil.resolve(page_url_obj, link_url_obj);
      }
    } else {
      link_url = urlutil.format(link_url_obj);
    }

    if (link_url != link_href) {
      $(this).attr('href', link_url);
    }
  });
}

exports.fromURL = function(url, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }
  
  if (options.verbose) console.log('Scrape:', url);

  downloader.downloadHtml(url, options, function(err, result) {
    if (err) return callback(err);
    if (!result || !result.html) return callback(new Error('Cannot download HTML'));

    var $ = cheerio.load(result.html);
    
    // fs.writeFileSync(__dirname + '/index.html', result.html, 'utf8');

    var page = {
      url: result.resolved_url || url,
    };

    fixLinks($, page, options);

    var links = [];
    $('body a').each(function() {
      var link_url = $(this).attr('href');
      if (isValidLink(link_url) && link_url.indexOf('reddit.com/r/') != -1
        && links.indexOf(link_url) == -1) {
        links.push(link_url);
      }
    });

    var subreddit_links = [];
    links.forEach(function(link) {
      var subreddit_name = link.replace('http://','').replace('https://','')
        .replace('www.reddit.com/r/', '').replace('reddit.com/r/', '').split('/')[0];
      var subreddit_link = 'https://www.reddit.com/r/' + subreddit_name;

      if (subreddit_links.indexOf(subreddit_link) == -1) {
        subreddit_links.push(subreddit_link);
      }
    });

    return callback(null, subreddit_links);
  });
}

exports.fromHtml = function(html, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }
  
  var $ = cheerio.load(html);

  var links = [];
  $('body a').each(function() {
    var link_url = $(this).attr('href');
    if (isValidLink(link_url) && link_url.indexOf('/r/') != -1) {
      if (link_url.indexOf('/r/') == 0) {
        link_url = 'https://www.reddit.com' + link_url;
      }
      if (links.indexOf(link_url) == -1) {
        links.push(link_url);
      }
    }
  });

  var subreddit_links = [];
  links.forEach(function(link) {
    var subreddit_name = link.replace('http://','').replace('https://','')
      .replace('www.reddit.com/r/', '').replace('reddit.com/r/', '').split('/')[0];
    var subreddit_link = 'https://www.reddit.com/r/' + subreddit_name;
    
    if (subreddit_links.indexOf(subreddit_link) == -1) {
      subreddit_links.push(subreddit_link);
    }
  });

  return callback(null, subreddit_links);
}
