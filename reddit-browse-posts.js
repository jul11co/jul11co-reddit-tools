#!/usr/bin/env node

var path = require('path');
var fs = require('fs');
var urlutil = require('url');

var async = require('async');
var fse = require('fs-extra');
var chalk = require('chalk');
var moment = require('moment');
var bytes = require('bytes');
var open = require('open');

var NeDB = require('nedb');
var lockFile = require('lockfile');

var express = require('express');
var session = require('express-session');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

var JsonStore = require('jul11co-jsonstore');
var JobQueue = require('jul11co-jobqueue');
var utils = require('jul11co-utils');

var downloader = require('jul11co-wdt').Downloader;

var RedditScraper = require('./lib/reddit-scraper');
var RedditPostDownloader = require('./lib/reddit-post-downloader');
var GfycatScraper = require('./lib/gfycat-scraper');
var ImgurScraper = require('./lib/imgur-scraper');

function printUsage() {
  console.log('Usage: reddit-browse-posts <data-dir> [OPTIONS]');
  console.log('       reddit-browse-posts --sources [--sources-file /path/to/sources.json] [--live] [OPTIONS]');
  console.log('');
  console.log('       reddit-browse-posts --live r/SUBREDDIT [OPTIONS]');
  console.log('       reddit-browse-posts --live https://www.reddit.com/r/SUBREDDIT [OPTIONS]');
  console.log('');
  console.log('       reddit-browse-posts --config');
  console.log('       reddit-browse-posts --config --secure [true|false]');
  console.log('       reddit-browse-posts --config --password PASSWORD');
  console.log('');
  console.log('OPTIONS:');
  console.log('     --verbose                   : verbose');
  console.log('     --no-cache                  : do not cache images,...');
  console.log('     --no-download               : do not download posts');
  console.log('');
}

if (process.argv.indexOf('-h') >= 0 
  || process.argv.indexOf('--help') >= 0
  || process.argv.length < 3) {
  printUsage();
  process.exit();
}

var options = {};
var argv = [];
for (var i = 2; i < process.argv.length; i++) {
  if (process.argv[i] == '--sources-file') {
    options.sources_file = process.argv[i+1];
    i++;
  } else if (process.argv[i].indexOf('--') == 0) {
    var arg = process.argv[i];
    if (arg.indexOf("=") > 0) {
      var arg_kv = arg.split('=');
      arg = arg_kv[0];
      arg = arg.replace('--','');
      arg = utils.replaceAll(arg, '-', '_');
      options[arg] = arg_kv[1];
    } else {
      arg = arg.replace('--','');
      arg = utils.replaceAll(arg, '-', '_');
      options[arg] = true;
    }
  } else {
    argv.push(process.argv[i]);
  }
}

// console.log(options);

if (argv.length < 1 && !options.sources && !options.config) {
  printUsage();
  process.exit();
}

process.on('SIGTERM', function() {
  process.exit();
});
process.on('SIGINT', function() {
  process.exit();
});

function getUserHome() {
  return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
}

var config_dir = path.join(getUserHome(), '.jul11co', 'reddit-tools');
var cache_dir = path.join(config_dir, 'cache');
if (options.local_cache) {
  cache_dir = path.join(data_dir, '_cache');
}
fse.ensureDirSync(cache_dir);

var browse_config = {};
var browse_config_file = path.join(config_dir, 'browse_config.json');
if (utils.fileExists(browse_config_file)) {
  browse_config = utils.loadFromJsonFile(browse_config_file);
}

if (options.config) {
  if (options.secure) {
    if (argv[0] == 'false') browse_config.secure = false;
    else browse_config.secure = true;
    console.log(browse_config);
    utils.saveToJsonFile(browse_config, browse_config_file, {backup: true});
    console.log('Config saved.');
    process.exit();
  } else if (options.password) {
    browse_config.password = utils.md5Hash(argv.join(' '));
    console.log(browse_config);
    utils.saveToJsonFile(browse_config, browse_config_file, {backup: true});
    console.log('Config saved.');
    process.exit();
  } else {
    console.log(browse_config);
    process.exit();
  }
}

var data_dir = '.';
if (options.sources) {
  data_dir = argv[0] || '.';
  if (options.sources_file) {
    options.sources_file = path.join('.', 'sources.json');
    data_dir = path.dirname(options.sources_file);
  } else {
    options.sources_file = path.join(data_dir, 'sources.json');
  }
  data_dir = path.resolve(data_dir);
} else if (options.live && argv[0].indexOf('r/') == 0) {
  var subreddit_name = argv[0].replace('r/','').split('/')[0];
  data_dir = path.resolve(path.join('.', 'r', subreddit_name));
} else if (options.live && argv[0].indexOf('http') == 0) {
  var subreddit_name = argv[0].replace('http://','').replace('https://','')
    .replace('www.reddit.com/r/','').replace('reddit.com/r/','').split('/')[0];
  data_dir = path.resolve(path.join('.', 'r', subreddit_name));
} else {
  data_dir = path.resolve(argv[0]);
}
console.log('Data directory:', data_dir);

if (options.live) {
  console.log('LIVE mode!');
}

var io = null;

var reddit_scraper = null;
var scraping_queue = new JobQueue();
var is_scraping = false;

var subreddits = [];
var all_subreddits = {};
var current_subreddit = '';

var posts_store = null;
var gfycat_cache = null;
var imgur_cache = null;
var favorites_cache = null;

var post_comments_cache = {};

var post_downloader = null;
var download_queue = new JobQueue();

var listen_port = 31111;
var server_started = false;

var posts_count = 0;
var image_posts_count = 0;
var video_posts_count = 0;
var nsfw_posts_count = 0;
var self_posts_count = 0;
var favorite_posts_count = 0;

var latest_created = 0;
var oldest_created = 0;

var authors_map = {};
var subreddits_map = {};
var domains_map = {};

var posts_map = {};
var post_tags_map = {};
var tags_map = {};

var popular_tags = [];
var popular_authors = [];
var popular_subreddits = [];
var popular_domains = [];

///

var getSubredditName = function(reddit_url) {
  return reddit_url
    .replace('https://reddit.com/r/','')
    .replace('https://www.reddit.com/r/','')
    .replace('http://reddit.com/r/','')
    .replace('http://www.reddit.com/r/','')
    .split('/')[0];
}

///

function getPostsCount(condition, callback) {
  posts_store.count(condition, function(err, count) {
    if (err) return callback(err);
    callback(null, count);
  });
}

function getPostInfo(post_id, callback) {
  posts_store.findOne({id: post_id}, function(err, post) {
    if (err) return callback(err);
    callback(null, post);
  });
}

function getPosts(condition, options, callback) {
  var skip = options.skip || 0;
  var limit = options.limit|| 100;
  var sort = options.sort || {created_utc: -1};
  // console.log('getPosts:', skip, limit, sort);
  posts_store.find(condition).sort(sort).skip(skip).limit(limit).exec(function(err, posts) {
    callback(err, posts);
  });
}

function getOver18Posts(condition, options, callback) {
  condition.over_18 = true;
  getPosts(condition, options, callback);
}

function getPostsOfAuthor(author, options, callback) {
  var condition = {author: author};
  getPosts(condition, options, callback);
}

///

var escapeRegExp = function(string) {
  if (!string) return '';
  return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
}

var replaceAllChars = function(string, chars, replace) {
  for (var i = 0; i < chars.length; i++) {
    string = string.replace(new RegExp(escapeRegExp(chars[i]), 'g'), replace)
  }
  return string;
}

function isUpperCase(c) {
    // return ((c >= 'A') && (c <= 'Z'));
    return c != '' && c == c.toUpperCase();
}

function isNumeric(string){
  return !isNaN(string)
}

var extractCapitalizedWords = function(string) {

  var capitalized_words = [];

  string = replaceAllChars(string, '?\'‘’-:,.(){}[]—_“”&#;\"\/《》「」【】', "|");
  // console.log('String (partitioned):', string);

  var partitions = string.split('|');
  // console.log('Partitions:', partitions.length);
  // console.log(partitions);

  var words = [];
  var tmp_w = [];

  partitions.forEach(function(part) {
    if (part == '') return;

    words = part.split(' ');
    tmp_w = [];

    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var first_c = w.slice(0,1);
      if (/*!isNumeric(w) && */isUpperCase(first_c)) {
        tmp_w.push(w);
      } else if (tmp_w.length) {
        var new_w = tmp_w.join(' ');
        if (capitalized_words.indexOf(new_w) == -1) capitalized_words.push(new_w);
        tmp_w = [];
      }
    }
    if (tmp_w.length) {
      var new_w = tmp_w.join(' ');
      if (capitalized_words.indexOf(new_w) == -1) capitalized_words.push(new_w);
      tmp_w = [];
    }
  });

  // console.log('Capilized words:', capitalized_words.length);
  // console.log(capitalized_words);

  return capitalized_words;
}

function ellipsisMiddle(str, max_length, first_part, last_part) {
  if (!max_length) max_length = 140;
  if (!first_part) first_part = 40;
  if (!last_part) last_part = 20;
  if (str.length > max_length) {
    return str.substr(0, first_part) + '...' + str.substr(str.length-last_part, str.length);
  }
  return str;
}

var sortItems = function(items, field, order) {
  if (order == 'desc') {
    items.sort(function(a,b) {
      if (a[field] > b[field]) return -1;
      if (a[field] < b[field]) return 1;
      return 0;
    });
  } else {
    items.sort(function(a,b) {
      if (a[field] > b[field]) return 1;
      if (a[field] < b[field]) return -1;
      return 0;
    });
  }
}

var startServer = function(done) {
  done = done || function() {};

  if (server_started) return done();

  var app = express();

  // view engine setup
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');
  app.use(session({
    secret: 'jul11co-reddit-posts-browser',
    resave: true,
    saveUninitialized: true
  }));
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({extended: true}));
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.static(cache_dir));

  // Authentication Middleware

  var auth = function(req, res, next) {
    if (!browse_config['secure'] && !browse_config['password']) {
      return next();
    } else if (req.session && req.session.loggedIn) {
      return next();
    } else {
      req.session.redirectUrl = req.originalUrl;
      return res.redirect('/login');
    }
  };

  var verifyPassword = function(password, verify_hash) {
    return utils.md5Hash(password) == verify_hash;
  }

  app.get('/login', function(req, res, next) {
    if (!browse_config['secure'] && !browse_config['password']) {
      return res.redirect('/');
    } else if (req.session && req.session.loggedIn) {
      return res.redirect('/');
    } else {
      res.render('login', {
        query: req.query
      });
    }
  });
   
  app.post('/login', function (req, res) {
    if (!browse_config['secure'] && !browse_config['password']) {
      req.session.loggedIn = true;
      if (req.session.redirectUrl) {
        var redirectUrl = req.session.redirectUrl;
        delete req.session.redirectUrl;
        return res.redirect(redirectUrl);
      }
      return res.redirect('/');
    }
    if (!req.body.password || !verifyPassword(req.body.password, browse_config['password'])) {
      console.log('login failed');
      res.redirect('/login');
    } else {
      console.log('login success');
      req.session.loggedIn = true;
      if (req.session.redirectUrl) {
        var redirectUrl = req.session.redirectUrl;
        delete req.session.redirectUrl;
        return res.redirect(redirectUrl);
      }
      res.redirect('/');
    }
  });

  app.get('/logout', function(req, res, next) {
    req.session.loggedIn = false;
    res.redirect('/');
  });
   
  var buildSearchCondition = function(query, search_field) {
    var condition = {};
    search_field = search_field || 'name';
    var queries = query.split(' ');
    if (queries.length == 1) {
      condition[search_field] = new RegExp(escapeRegExp(query), 'i');
    } else {
      condition.$and = [];
      queries.forEach(function(q) {
        var cond = {};
        cond[search_field] = new RegExp(escapeRegExp(q), 'i');
        condition.$and.push(cond);
      });
    }
    return condition;
  }

  // GET /
  // GET /?load_subreddit=...
  // GET /?author=...
  // GET /?subreddit=...
  // GET /?domain=...
  // GET /?images=1
  // GET /?videos=1
  // GET /?nsfw=1
  // GET /?limit=...&skip=...&sort=...
  // GET /?tag=...
  app.get('/', auth, function(req, res) {
    
    if (req.query.load_subreddit) {
      if (req.query.load_subreddit == current_subreddit) {
        return res.redirect('/');
      }
      if (!all_subreddits[req.query.load_subreddit]) {
        return res.status(400).send('Unavailable subreddit: ' + req.query.load_subreddit);
      }

      var subreddit_grouped = false;
      var subreddit_groups = {};
      if (subreddits.length>100) {
        subreddit_grouped = true;
        var first_char = '';
        subreddits.forEach(function(subreddit) {
          if (subreddit.starred) return;
          first_char = subreddit.name[0].toUpperCase();
          if (!isNaN(parseInt(first_char))) first_char = '#';
          if (!subreddit_groups[first_char]) subreddit_groups[first_char] = [];
          subreddit_groups[first_char].push(subreddit); 
        });
      }

      var starred_subreddits = subreddits.filter(function(subreddit) {
        return subreddit.starred;
      });
      var unstarred_subreddits = subreddits.filter(function(subreddit) {
        return !subreddit.starred;
      });
      var subreddit_grouped = false;
      var subreddit_groups = {};
      if (subreddits.length>100) {
        subreddit_grouped = true;
        var first_char = '';
        subreddits.forEach(function(subreddit) {
          if (subreddit.starred) return;
          first_char = subreddit.name[0].toUpperCase();
          if (!isNaN(parseInt(first_char))) first_char = '#';
          if (!subreddit_groups[first_char]) subreddit_groups[first_char] = [];
          subreddit_groups[first_char].push(subreddit); 
        });
      }

      return res.render('load-subreddit', {
        query: req.query,
        enable_download: !options.no_download,
        subreddits: subreddits,
        starred_subreddits: starred_subreddits,
        unstarred_subreddits: unstarred_subreddits,
        subreddit_grouped: subreddit_grouped,
        subreddit_groups: subreddit_groups,
        current_subreddit: current_subreddit,
        bytes: bytes,
        moment: moment,
        ellipsisMiddle: ellipsisMiddle,
        trimText: utils.trimText
      });

      // return process.nextTick(function() {
      //   if (io) io.emit('reloading');
      //   if (io) io.emit('reloading-log', {text: 'Unloading ' + current_subreddit + '...'});

      //   unloadSubredditData(all_subreddits[current_subreddit].data_dir, function(err) {
      //     if (err) {
      //       if (io) io.emit('reloading-eror', {error: 'Unload ' + current_subreddit + ' failed: ' + err.message});
      //     }
      //     if (io) io.emit('reloading-log', {text: 'Unloading ' + current_subreddit + '... Success!'});
      //     if (io) io.emit('reloading-log', {text: 'Loading ' + req.query.load_subreddit + '...'});
      //     loadSubredditData(all_subreddits[req.query.load_subreddit].data_dir, function(err) {
      //       if (err) {
      //         if (io) io.emit('reloading-eror', {error: 'Load ' + req.query.load_subreddit + ' failed: ' + err.message});
      //         console.log('Subreddit load failed: ' + req.query.load_subreddit);
      //         // return res.status(404).send('Subreddit not found: ' + req.query.load_subreddit);
      //       }
      //       if (io) io.emit('reload-done');
      //       // res.redirect('/');
      //     });
      //   });
      // });
    } else if (req.query.reload_subreddits) {
      return reloadSubredditList(function(err) {
        if (err) return res.status(500).send('Reload subreddit list failed: ' + err.message);
        res.redirect('/');
      });
    }

    var opts = {};
    opts.limit = req.query.limit ? parseInt(req.query.limit) : 100;
    opts.skip = req.query.skip ? parseInt(req.query.skip) : 0;
    var sort_field = req.query.sort || req.session.sort || 'created_utc';
    var sort_order = req.query.order || req.session.order || 'desc';
    opts.sort = {};
    if (sort_order == 'desc') {
      opts.sort[sort_field] = -1;
    } else {
      opts.sort[sort_field] = 1;
    }

    var query = req.query;
    if (req.query.sort && req.session.sort != req.query.sort) req.session.sort = req.query.sort;
    if (req.query.order && req.session.order != req.query.order) req.session.order = req.query.order;
    if (!req.query.sort) {
      query.sort = req.session.sort || sort_field;
      query.order = query.order || req.session.order || sort_order;
    }

    var condition = {};
    if (req.query.images) condition.post_hint = 'image';
    if (req.query.videos) condition.post_hint = 'video';
    if (req.query.over_18 || req.query.nsfw) condition.over_18 = true;
    if (req.query.self) condition.is_self = true;
    if (req.query.author) condition.author = req.query.author;
    if (req.query.subreddit) condition.subreddit = req.query.subreddit;
    if (req.query.domain) condition.domain = req.query.domain;
    if (req.query.q) {
      condition = buildSearchCondition(req.query.q, 'title');
    }

    // console.log(condition);
    // console.log(opts);

    var subreddit_grouped = false;
    var subreddit_groups = {};
    if (subreddits.length>100) {
      subreddit_grouped = true;
      var first_char = '';
      subreddits.forEach(function(subreddit) {
        if (subreddit.starred) return;
        first_char = subreddit.name[0].toUpperCase();
        if (!isNaN(parseInt(first_char))) first_char = '#';
        if (!subreddit_groups[first_char]) subreddit_groups[first_char] = [];
        subreddit_groups[first_char].push(subreddit); 
      });
    }

    var starred_subreddits = subreddits.filter(function(subreddit) {
      return subreddit.starred;
    });
    var unstarred_subreddits = subreddits.filter(function(subreddit) {
      return !subreddit.starred;
    });
    var subreddit_grouped = false;
    var subreddit_groups = {};
    if (subreddits.length>100) {
      subreddit_grouped = true;
      var first_char = '';
      subreddits.forEach(function(subreddit) {
        if (subreddit.starred) return;
        first_char = subreddit.name[0].toUpperCase();
        if (!isNaN(parseInt(first_char))) first_char = '#';
        if (!subreddit_groups[first_char]) subreddit_groups[first_char] = [];
        subreddit_groups[first_char].push(subreddit); 
      });
    }

    var render_params = {
      query: query,
      enable_download: !options.no_download,
      subreddits: subreddits,
      starred_subreddits: starred_subreddits,
      unstarred_subreddits: unstarred_subreddits,
      subreddit_grouped: subreddit_grouped,
      subreddit_groups: subreddit_groups,
      current_subreddit: current_subreddit,
      posts_count: posts_count,
      image_posts_count: image_posts_count,
      video_posts_count: video_posts_count,
      nsfw_posts_count: nsfw_posts_count,
      self_posts_count: self_posts_count,
      favorite_posts_count: favorite_posts_count,
      popular_authors: popular_authors,
      popular_subreddits: popular_subreddits,
      popular_domains: popular_domains,
      popular_tags: popular_tags,
      bytes: bytes,
      moment: moment,
      ellipsisMiddle: ellipsisMiddle,
      trimText: utils.trimText
    }

    if (req.query.tag && tags_map[req.query.tag]) {
      var count = tags_map[req.query.tag].posts_count;
      var posts = tags_map[req.query.tag].posts.map(function(post_id) {
        return posts_map[post_id];        
      });

      if (req.session.sort && req.session.order) {
        sortItems(posts, req.session.sort, req.session.order);
      }
      
      var start_index = Math.min(opts.skip, posts.length);
      var end_index = Math.min(opts.skip + opts.limit, posts.length);
      posts = posts.slice(start_index, end_index);

      posts.forEach(function(post) {
        if (favorites_cache.get(post.id)) {
          post.favorited = true;
        }
      });

      render_params.count = count;
      render_params.posts = posts;

      res.render('reddit-browser', render_params);
    } else if (req.query.favorites) {
      var favorite_posts = [];
      for (var post_id in favorites_cache.toMap()) {
        favorite_posts.push(post_id);
      }
      var count = favorite_posts.length;
      var posts = favorite_posts.map(function(post_id) {
        return posts_map[post_id];
      });

      if (req.session.sort && req.session.order) {
        sortItems(posts, req.session.sort, req.session.order);
      }
      
      var start_index = Math.min(opts.skip, posts.length);
      var end_index = Math.min(opts.skip + opts.limit, posts.length);
      posts = posts.slice(start_index, end_index);

      posts.forEach(function(post) {
        post.favorited = true;
      });

      render_params.count = count;
      render_params.posts = posts;

      res.render('reddit-browser', render_params);
    } else {
      getPostsCount(condition, function(err, count) {
        if (err) return res.status(500).send(err.message);

        getPosts(condition, opts, function(err, posts) {
          if (err) return res.status(500).send(err.message);

          // console.log('Posts:', posts.length);

          posts.forEach(function(post) {
            if (post_tags_map[post.id]) {
              post.tags = post_tags_map[post.id].slice(0);
            }
            if (favorites_cache.get(post.id)) {
              post.favorited = true;
            }
          });

          render_params.count = count;
          render_params.posts = posts;

          res.render('reddit-browser', render_params);
        });
      });
    }
  });

  // GET /open?path=...
  app.get('/open', auth, function(req, res) {
    var fpath = path.join(data_dir, req.query.path);
    open(fpath);
    return res.send('OK');
  });

  // GET /file?path=...
  app.get('/file', auth, function(req, res) {
    var filepath = path.join(data_dir, req.query.path);
    return res.sendFile(filepath);
  });

  // GET /files/:filename?path=...
  app.get('/files/:filename', auth, function(req, res) {
    var filepath = path.join(data_dir, req.query.path);
    return res.sendFile(filepath);
  });

  // GET /favorite?post_id=...
  app.post('/favorite', auth, function(req, res) {
    if (!req.query.post_id) {
      return res.status(400).json({error: 'Missing post_id'});
    }

    if (!favorites_cache.get(req.query.post_id)) {
      favorites_cache.set(req.query.post_id, {faved_at: new Date()});
      favorite_posts_count++;
    }

    res.json({favorited: true});
  });

  // GET /unfavorite?post_id=...
  app.post('/unfavorite', auth, function(req, res) {
    if (!req.query.post_id) {
      return res.status(400).json({error: 'Missing post_id'});
    }

    if (favorites_cache.get(req.query.post_id)) {
      favorites_cache.delete(req.query.post_id);
      favorite_posts_count--;
    }

    res.json({unfavorited: true});
  });

  // GET /download?post_id=...
  app.post('/download', auth, function(req, res) {
    if (!req.query.post_id) {
      return res.status(400).json({error: 'Missing post_id'});
    }
    // get post info
    getPostInfo(req.query.post_id, function(err, post) {
      if (err) return res.status(500).json({error: err.message});
      if (!post) return res.status(404).json({error: 'Post not found'});

      console.log('Download post:', post.title, '-', post.url);
      // download the post
      post_downloader.downloadPost(post, function(err) {
        if (err) return res.status(500).json({error: err.message});

        res.json({downloaded: true});
      });
    });
  });

  // GET /gfycat?url=...
  app.get('/gfycat', auth, function(req, res) {
    if (!req.query.url) {
      return res.status(400).json({error: 'Missing url'});
    }
    if (gfycat_cache && gfycat_cache.get(req.query.url)) {
      return res.json(gfycat_cache.get(req.query.url));
    }
    // get page info
    GfycatScraper.scrape(req.query.url, {}, function(err, page_info) {
      if (err) return res.status(500).json({error: err.message});
      if (!page_info) return res.status(404).json({error: 'Page info not found'});
      // console.log(page_info);
      gfycat_cache.update(req.query.url, page_info);
      gfycat_cache.update(req.query.url, {scraped_at: new Date()});
      res.json(page_info);
    });
  });

  // GET /imgur?url=...
  app.get('/imgur', auth, function(req, res) {
    if (!req.query.url) {
      return res.status(400).json({error: 'Missing url'});
    }
    if (imgur_cache && imgur_cache.get(req.query.url)) {
      return res.json(imgur_cache.get(req.query.url));
    }
    // get page info
    ImgurScraper.scrape(req.query.url, {}, function(err, page_info) {
      if (err) return res.status(500).json({error: err.message});
      if (!page_info) return res.status(404).json({error: 'Page info not found'});
      imgur_cache.update(req.query.url, page_info);
      imgur_cache.update(req.query.url, {scraped_at: new Date()});
      res.json(page_info);
    });
  });

  app.get('/r*', function(req, res) {
    console.log(req.originalUrl);
    return res.redirect('https://www.reddit.com' + req.originalUrl);
  })

  app.get('/u*', function(req, res) {
    console.log(req.originalUrl);
    return res.redirect('https://www.reddit.com' + req.originalUrl);
  })

  var timeToNow = function(date) {
    return (new Date().getTime() - date.getTime());
  }

  // GET /post?post_id=...
  app.get('/post', function(req, res) {
    if (!req.query.post_id) {
      return res.status(400).json({error: 'Missing post_id'});
    }
    getPostInfo(req.query.post_id, function(err, post) {
      if (err) return res.status(500).json({error: err.message});
      if (!post) return res.status(404).json({error: 'Post not found'});
      
      res.json(post);
    });
  });

  // GET /post_comments?post_id=...
  app.get('/post_comments', function(req, res) {
    if (!req.query.post_id) {
      return res.status(400).json({error: 'Missing post_id'});
    }
    var post_id = req.query.post_id;
    if (post_comments_cache[post_id]) {
      if (timeToNow(post_comments_cache[post_id].cached_at) < 900000) { // 15*60*1000 = 15 minutes
        return res.json(post_comments_cache[post_id].data);
      }
    }
    if (!reddit_scraper) {
      reddit_scraper = new RedditScraper();
    }
    reddit_scraper.getPost(current_subreddit, post_id, function(err, result) {
      if (err) return res.status(500).json({error: err.message});
      if (!result) return res.status(500).json({error: 'Cannot get post comments'});
      post_comments_cache[post_id] = {
        cached_at: new Date(),
        data: {
          num_comments: result.num_comments,
          comments: result.comments
        }
      }
      res.json({
        post_id: post_id,
        num_comments: result.num_comments,
        comments: result.comments
      });
    });
  });

  // GET /star?subreddit=...
  app.post('/star', auth, function(req, res) {
    if (!req.query.subreddit) {
      return res.status(400).json({error: 'Missing subreddit'});
    }

    var subreddit_name = req.query.subreddit;

    if (!all_subreddits[subreddit_name]) {
      return res.status(400).json({error: 'Subreddit not found'});
    }
    if (all_subreddits[subreddit_name].starred) {
      return res.json({starred: true});
    }

    all_subreddits[subreddit_name].starred = true;
    for (var i = 0; i < subreddits.length; i++) {
      var subreddit = subreddits[i];
      if (subreddit.name == subreddit_name) {
        subreddit.starred = true;
      }
    }

    var starred_subreddits_info = {};
    if (utils.fileExists(path.join(data_dir, 'stars.json'))) {
      starred_subreddits_info = utils.loadFromJsonFile(path.join(data_dir, 'stars.json'));
    }

    if (starred_subreddits_info[subreddit_name]) {
      return res.json({starred: true});
    }

    starred_subreddits_info[subreddit_name] = {
      starred_at: new Date()
    };
    
    utils.saveToJsonFile(starred_subreddits_info, path.join(data_dir, 'stars.json'));

    return res.json({starred: true});
  });

  // GET /unstar?subreddit=...
  app.post('/unstar', auth, function(req, res) {
    if (!req.query.subreddit) {
      return res.status(400).json({error: 'Missing subreddit'});
    }

    var subreddit_name = req.query.subreddit;

    if (!all_subreddits[subreddit_name]) {
      return res.status(400).json({error: 'Subreddit not found'});
    }
    if (!all_subreddits[subreddit_name].starred) {
      return res.json({unstarred: true});
    }

    all_subreddits[subreddit_name].starred = false;
    for (var i = 0; i < subreddits.length; i++) {
      var subreddit = subreddits[i];
      if (subreddit.name == subreddit_name) {
        subreddit.starred = false;
      }
    }

    var starred_subreddits_info = {};
    if (utils.fileExists(path.join(data_dir, 'stars.json'))) {
      starred_subreddits_info = utils.loadFromJsonFile(path.join(data_dir, 'stars.json'));
    }

    if (!starred_subreddits_info[subreddit_name]) {
      return res.json({starred: true});
    }

    delete starred_subreddits_info[subreddit_name];
    
    utils.saveToJsonFile(starred_subreddits_info, path.join(data_dir, 'stars.json'));

    return res.json({starred: true});
  });

  //// Caching

  var getCachedImagePath = function(image_src) {
    var url_obj = urlutil.parse(image_src);
    var url_hostname = (url_obj) ? url_obj.hostname : '';
    var cached_image_path = '';
    if (!url_hostname || url_hostname == '') {
      cached_image_path = path.join('images', 'nohost', url_obj.pathname);
    } else {
      cached_image_path = path.join('images', url_hostname, url_obj.pathname);
    }
    return cached_image_path;
  }

  // GET /image?src=...
  app.get('/image', auth, function (req, res, next) {
    if (typeof req.query.src == 'undefined') {
      res.writeHead(400); // Bad Request
      res.end();
      return;
    }

    var image_src = req.query.src;
    if (image_src.indexOf('//') == 0) {
      image_src = 'http:' + image_src;
    }

    if (options.no_cache) {
      return res.redirect(image_src);
    }

    // console.log(image_src);
    var cached_image_path = getCachedImagePath(image_src);
    var cached_image_abs_path = path.join(cache_dir, cached_image_path);

    download_queue.pushJob({
      image_src: image_src,
      cached_image_abs_path: cached_image_abs_path
    }, function(args, done) {
      // console.log(cached_image_abs_path);
      if (utils.fileExists(args.cached_image_abs_path)) {
        return done();
      }
      downloader.downloadFile(args.image_src, args.cached_image_abs_path, function(err, result) {
        return done(err);
      });
    }, function(err) {
      if (err) {
        res.writeHead(404);
        res.end();
      } else {
        res.redirect(cached_image_path);
      }
    });
  });

  //// End of Caching

  var reloading_subreddit = false;

  var http = require('http').Server(app);
  io = require('socket.io')(http);
  io.on('connection', function(socket) {
    if (is_scraping) socket.emit('scraping');

    socket.on('reload-subreddit', function(data) {
      if (data.subreddit_name && data.subreddit_name != current_subreddit) {
        if (!all_subreddits[data.subreddit_name]) {
          io.emit('reloading-eror', {error: 'Missing subreddit: ' + data.subreddit_name + ''});
          return;
        }
        if (reloading_subreddit) return;

        reloading_subreddit = true;

        io.emit('reloading');
        io.emit('reloading-log', {text: 'Unloading subreddit: ' + current_subreddit + '...'});

        unloadSubredditData(all_subreddits[current_subreddit].data_dir, function(err) {
          if (err) {
            io.emit('reloading-eror', {error: 'Unload subreddit: ' + current_subreddit + ' failed: ' + err.message});
          }
          io.emit('reloading-log', {text: 'Unloading subreddit: ' + current_subreddit + '... Success!'});
          io.emit('reloading-log', {text: 'Loading subreddit: ' + data.subreddit_name + '...'});
          loadSubredditData(all_subreddits[data.subreddit_name].data_dir, function(err) {
            if (err) {
              console.log('Load subreddit failed: ' + data.subreddit_name);
              io.emit('reloading-eror', {error: 'Load ' + data.subreddit_name + ' failed: ' + err.message});
            } else {
              io.emit('reloading-log', {text: 'Loading subreddit: ' + data.subreddit_name + '... Success!'});
            }

            reloading_subreddit = false;

            io.emit('reload-done');
          });
        });
      }
    });
  });

  var startListen = function(callback) {
    http.listen(listen_port, function () {
      console.log('Listening on http://localhost:'+listen_port);
      if (!options.no_open) open('http://localhost:'+listen_port);

      server_started = true;
      callback();
    }).on('error', function(err) {
      if (err.code == 'EADDRINUSE') {
        setTimeout(function() {
          listen_port = listen_port + 1;
          startListen(callback);
        });
      } else {
        console.log(err);
        callback(err);
      }
    });
  }

  startListen(done);
}

///

var sortByPostsCount = function(array) {
  array.sort(function(a,b) {
    if (a.posts_count > b.posts_count) return -1;
    if (a.posts_count < b.posts_count) return 1;
    return 0;
  })
}

function indexPosts(done) {

  posts_count = 0;
  image_posts_count = 0;
  video_posts_count = 0;
  nsfw_posts_count = 0;
  self_posts_count = 0;
  favorite_posts_count = 0;

  latest_created = 0;
  oldest_created = 0;

  authors_map = {};
  subreddits_map = {};
  domains_map = {};

  posts_map = {};
  post_tags_map = {};
  tags_map = {};

  popular_tags = [];
  popular_authors = [];
  popular_subreddits = [];
  popular_domains = [];

  console.log('Indexing posts...');
  if (io) io.emit('reloading-log', {text: 'Indexing posts...'});
  posts_store.find({}, function(err, posts) {
    if (err) {
      console.log(err);
      return done(err);
    }
    
    posts_count = posts.length;
    console.log('Posts:', posts_count);
    if (io) io.emit('reloading-log', {text: 'Posts: ' + posts_count});

    posts.forEach(function(post) {
      if (post.post_hint == 'image') image_posts_count++;
      else if (post.post_hint == 'video') video_posts_count++;
      if (post.over_18) nsfw_posts_count++;
      if (post.is_self) self_posts_count++;
      if (latest_created == 0 || latest_created < post.created_utc) latest_created = post.created;
      if (oldest_created == 0 || oldest_created > post.created_utc) oldest_created = post.created;
      if (post.author) {
        if (authors_map[post.author]) authors_map[post.author] += 1;
        else authors_map[post.author] = 1;
      }
      if (post.subreddit) {
        if (subreddits_map[post.subreddit]) subreddits_map[post.subreddit] += 1;
        else subreddits_map[post.subreddit] = 1;
      }
      if (post.domain) {
        if (domains_map[post.domain]) domains_map[post.domain] += 1;
        else domains_map[post.domain] = 1;
      }
      var post_info = Object.assign({}, post);
      if (post.title) {
        var post_tags = extractCapitalizedWords(post.title);
        if (post_tags && post_tags.length) {
          post_tags_map[post.id] = post_tags;
          post_tags.forEach(function(tag) {
            if (tags_map[tag]) {
              tags_map[tag].posts.push(post.id);
              tags_map[tag].posts_count += 1;
            } else {
              tags_map[tag] = {};
              tags_map[tag].posts = [];
              tags_map[tag].posts.push(post.id);
              tags_map[tag].posts_count = 1;
            }
          });
          post_info.tags = post_tags;
        }
      }
      posts_map[post_info.id] = post_info;
    });

    console.log('Image Posts:', image_posts_count);
    console.log('Video Posts:', video_posts_count);
    console.log('NSFW Posts:', nsfw_posts_count);
    if (io) {
      io.emit('reloading-log', {text: 'Image Posts: ' + image_posts_count});
      io.emit('reloading-log', {text: 'Video Posts: ' + video_posts_count});
      io.emit('reloading-log', {text: 'NSFW Posts: ' + nsfw_posts_count});
    }

    for (var post_id in favorites_cache.toMap()) {
      favorite_posts_count++;
    }
    console.log('Favorite Posts:', favorite_posts_count);
    if (io) io.emit('reloading-log', {text: 'Favorite Posts: ' + favorite_posts_count});

    var authors = [];
    for (var author in authors_map) {
      authors.push({name: author, posts_count: authors_map[author]});
    }
    console.log('Authors:', authors.length);
    if (io) io.emit('reloading-log', {text: 'Authors: ' + authors.length});
    sortByPostsCount(authors);
    if (authors.length > 20) popular_authors = authors.slice(0, 20);
    else popular_authors = authors.slice();

    var subreddits = [];
    for (var subreddit in subreddits_map) {
      subreddits.push({name: subreddit, posts_count: subreddits_map[subreddit]});
    }
    console.log('Subreddits:', subreddits.length);
    if (io) io.emit('reloading-log', {text: 'Subreddits: ' + subreddits.length});
    sortByPostsCount(subreddits);
    if (subreddits.length > 20) popular_subreddits = subreddits.slice(0, 20);
    else popular_subreddits = subreddits.slice();

    var domains = [];
    for (var domain in domains_map) {
      domains.push({name: domain, posts_count: domains_map[domain]});
    }
    console.log('Domains:', domains.length);
    if (io) io.emit('reloading-log', {text: 'Domains: ' + domains.length});
    sortByPostsCount(domains);
    if (domains.length > 20) popular_domains = domains.slice(0, 20);
    else popular_domains = domains.slice();

    var tags = [];
    for (var tag_name in tags_map) {
      tags.push({name: tag_name, posts_count: tags_map[tag_name].posts_count});
    }
    console.log('Tags:', tags.length);
    if (io) io.emit('reloading-log', {text: 'Tags: ' + tags.length});
    sortByPostsCount(tags);
    if (tags.length > 20) popular_tags = tags.slice(0, 20);
    else popular_tags = tags.slice();

    done();
  });
}

var createBrowsePostsDB = function(subreddit_dir, done) {
  if (!options.live) {
    if (!utils.fileExists(path.join(subreddit_dir, 'posts.db'))) {
      return done(new Error('Missing posts.db'));
    }
  }

  lockFile.lock(path.join(subreddit_dir, 'reddit.lock'), {}, function (err) {
    if (err) {
      return done(err);
    }

    fse.copy(path.join(subreddit_dir, 'posts.db'), 
      path.join(subreddit_dir, 'posts-browse.db'), {overwrite: true}, function(err) {
      if (err) {
        return done(err);
      }

      lockFile.unlock(path.join(subreddit_dir, 'reddit.lock'), function (err) {
        if (err) {
          return done(err);
        }

        return done();
      });
    });
  });
}

var loadSubredditData = function(subreddit_dir, done) {
  console.log('Load subreddit data:', subreddit_dir);

  fse.ensureDirSync(subreddit_dir);
  current_subreddit = path.basename(subreddit_dir);

  createBrowsePostsDB(subreddit_dir, function (err) {
    if (err) {
      console.log(err);
      return done(err);
    }

    lockFile.lock(path.join(subreddit_dir, 'reddit-browse.lock'), {}, function (err) {
      if (err) {
        console.log(err);
        return done(err);
      }

      if (!utils.fileExists(path.join(subreddit_dir, 'posts-browse.db'))) {
        console.log('Missing posts-browse.db');
        return done(new Error('Missing posts-browse.db'));
      }

      post_downloader = new RedditPostDownloader(subreddit_dir, options);

      post_comments_cache = {};

      gfycat_cache = new JsonStore({
        file: path.join(subreddit_dir, 'gfycat.json')
      });

      imgur_cache = new JsonStore({
        file: path.join(subreddit_dir, 'imgur.json')
      });

      favorites_cache = new JsonStore({
        file: path.join(subreddit_dir, 'favorites.json')
      });

      posts_store = new NeDB({
        filename: path.join(subreddit_dir, 'posts-browse.db'),
        autoload: true
      });

      if (options.live) {
        if (reddit_scraper) {
          reddit_scraper.destroy();
          reddit_scraper = null;
        }

        // create new scraper
        reddit_scraper = new RedditScraper({
          output_dir: subreddit_dir,
          posts_store: posts_store
        });

        reddit_scraper.on('progress', function(data) {
          if (io) io.emit('scraping-progress', data);
        });

        scraping_queue.pushJob({subreddit: current_subreddit}, function(args, done) {
          // update data from subreddit
          console.log('Update data from subreddit:', args.subreddit);
          is_scraping = true;
          reddit_scraper.processSubreddit(args.subreddit, {stop_if_no_new_posts: true}, done);
        }, function(err) {
          is_scraping = false;
          if (err) {
            console.log(err);
          } else {
            var stats = reddit_scraper.getStats();
            if (stats && stats.new_posts_count) {
              indexPosts(function(err) {
                if (err) {
                  console.log(err);
                }
                if (io) io.emit('scraping-done', {new_posts_count: stats.new_posts_count});
              });
            } else {
              if (io) io.emit('scraping-done', {new_posts_count: 0});
            }
          }
        });

        indexPosts(function(err) {
          if (err) {
            console.log(err);
            return done(err);
          }
          startServer(done);
        });
      } else {
        indexPosts(function(err) {
          if (err) {
            console.log(err);
            return done(err);
          }
          startServer(done);
        });
      }
    });
  });
}

var unloadSubredditData = function(subreddit_dir, done) {
  lockFile.unlock(path.join(subreddit_dir, 'reddit-browse.lock'), function (err) {
    if (err) {
      console.log(err);
    }

    if (gfycat_cache) gfycat_cache.exit();
    if (imgur_cache) imgur_cache.exit();
    if (favorites_cache) favorites_cache.exit();

    posts_count = 0;
    image_posts_count = 0;
    video_posts_count = 0;
    nsfw_posts_count = 0;
    self_posts_count = 0;
    favorite_posts_count = 0;

    latest_created = 0;
    oldest_created = 0;

    authors_map = {};
    subreddits_map = {};
    domains_map = {};

    posts_map = {};
    post_tags_map = {};
    tags_map = {};

    popular_tags = [];
    popular_authors = [];
    popular_subreddits = [];
    popular_domains = [];

    return done();
  });
}

var loadSubredditList = function(done) {

  if (options.sources && utils.fileExists(options.sources_file)) {
    var sources_info = utils.loadFromJsonFile(options.sources_file);
    for (var source_url in sources_info) {
      var subreddit_name = getSubredditName(source_url);
      if (!all_subreddits[subreddit_name]) {
        all_subreddits[subreddit_name] = {
          url: source_url, 
          name: subreddit_name,
          nsfw: sources_info[source_url].nsfw,
          config: sources_info[source_url],
          data_dir: path.join(data_dir, 'r', subreddit_name)
        }
      }
    }
  } else if (utils.fileExists(path.join(data_dir, 'reddit.json'))) {
    var sources_info = utils.loadFromJsonFile(path.join(data_dir, 'reddit.json'));
    for (var source_url in sources_info) {
      var subreddit_name = getSubredditName(source_url);
      if (!all_subreddits[subreddit_name]) {
        all_subreddits[subreddit_name] = {
          url: source_url, 
          name: subreddit_name,
          nsfw: sources_info[source_url].nsfw,
          config: sources_info[source_url],
          data_dir: data_dir
        }
      }
    }
  }

  if (utils.fileExists(path.join(data_dir, 'stars.json'))) {
    var starred_subreddits_info = utils.loadFromJsonFile(path.join(data_dir, 'stars.json'));
    for (var subreddit_name in starred_subreddits_info) {
      if (all_subreddits[subreddit_name]) {
        all_subreddits[subreddit_name].starred = true;
      }
    }
  }
  
  for (var subreddit_name in all_subreddits) {
    subreddits.push(all_subreddits[subreddit_name]);
  }

  if (!options.live) {
    subreddits = subreddits.filter(function(subreddit) {
      // console.log('Subreddit:', subreddit.name);
      // return utils.fileExists(path.join(data_dir, 'r', subreddit.name, 'posts.db'));
      return utils.fileExists(path.join(subreddit.data_dir, 'posts.db'));
    });
    console.log('Available Subreddits:', subreddits.length);
  }

  subreddits.sort(function(a,b) {
    if (a.name.toLowerCase() > b.name.toLowerCase()) return 1;
    else if (a.name.toLowerCase() < b.name.toLowerCase()) return -1;
    return 0;
  });

  return done();
}

var reloadSubredditList = function(done) {
  subreddits = [];

  return loadSubredditList(done);
}

///

loadSubredditList(function() {  
  if (subreddits.length == 0) {
    process.exit(0);
  }

  loadSubredditData(subreddits[0].data_dir, function(err) {
    if (err) {
      process.exit(1);
    }
  });
});
