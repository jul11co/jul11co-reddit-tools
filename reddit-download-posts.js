#!/usr/bin/env node

var async = require('async');
var path = require('path');
var chalk = require('chalk');
var moment = require('moment');

var spawn = require('child_process').spawn;

var NeDB = require('nedb');
var lockFile = require('lockfile');

var JsonStore = require('jul11co-jsonstore');
var JobQueue = require('jul11co-jobqueue');

var utils = require('jul11co-utils');
var downloader = require('jul11co-wdt').Downloader;

function printUsage() {
  console.log('Usage: reddit-download-posts <data-dir> [OPTIONS]');
  console.log('');
  console.log('OPTIONS:');
  console.log('  --verbose                        : verbose');
  console.log('');
  console.log('  --favorites                      : download favorite posts (specified in favorites.json)');
  console.log('');
  console.log('  --exported-posts                 : download exported posts');
  console.log('  --exported-posts=file=<FILE>     : exported posts file');
  console.log('');
  console.log('  --images                         : download image posts');
  console.log('  --imgur                          : download imgur posts');
  console.log('  --gfycat                         : download gfycat posts');
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
  if (process.argv[i].indexOf('--') == 0) {
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

if (argv.length < 1) {
  printUsage();
  process.exit();
}

process.on('SIGTERM', function() {
  process.exit();
});
process.on('SIGINT', function() {
  process.exit();
});

var data_dir = argv[0];
console.log('Data directory:', data_dir);

var images_output_dir = path.join(data_dir, 'images');

var favorites_cache = null;
var downloads_cache = null;
var download_queue = new JobQueue(/*{debug: true}*/);

function isAlpha(ch){
  return /^[A-Z]$/i.test(ch);
}

function matchAny(string, array) {
  var no_matched = true;
  for (var i = 0; i < array.length; i++) {
    if (string.indexOf(array[i]) >= 0) {
      no_matched = false;
      break;
    }
  }
  return !no_matched;
}

function isUrlMatch(url, hosts) {
  if (Array.isArray(hosts)) {
    return matchAny(url, hosts);
  } else if (typeof hosts == 'string') {
    return (url.indexOf(hosts) >= 0);
  } else if (typeof hosts == 'function') {
    return hosts(url);
  } 
  return false;
}

var numberPadding = function(number, count, padding) {
  padding = padding || '0';
  var output = '' + number;
  if (count && output.length < count) {
    while (output.length < count) {
      output = padding + output;
    }
  }
  return output;
}

var dateFormat = function(date, format) {
  var output = format || '';
  output = output.replace('YYYY', '' + date.getFullYear());
  output = output.replace('MM', '' + numberPadding(date.getMonth(),2));
  output = output.replace('DD', '' + numberPadding(date.getDate(),2));
  output = output.replace('hh', '' + numberPadding(date.getHours(),2));
  output = output.replace('mm', '' + numberPadding(date.getMinutes(),2));
  output = output.replace('ss', '' + numberPadding(date.getSeconds(),2));
  return output;
}

var logDate = function() {
  return dateFormat(new Date(), 'YYYY/MM/DD hh:mm:ss');
}

var logger = {
  log: function(module) {
    if (typeof module == 'object') {
      console.log(chalk.grey('[' + logDate() + ']'), 
        chalk.magenta(module.id || module), 
        Array.prototype.slice.call(arguments,1).join(' ')
      );
    } else {
      console.log(chalk.grey('[' + logDate() + ']'), 
        Array.prototype.slice.call(arguments)
      );
    }
  },

  logInfo: function(module) {
    console.log(chalk.grey('[' + logDate() + ']'), 
      chalk.green(module.id || module), 
      Array.prototype.slice.call(arguments,1).join(' ')
    );
  },

  logDebug: function(module) {
    console.log(chalk.grey('[' + logDate() + ']'), 
      chalk.blue(module.id || module), 
      Array.prototype.slice.call(arguments,1).join(' ')
    );
  },

  logWarn: function(module) {
    console.log(chalk.grey('[' + logDate() + ']'), 
      chalk.yellow(module.id || module), 
      Array.prototype.slice.call(arguments,1).join(' ')
    );
  },

  logError: function(module) {
    console.log(chalk.grey('[' + logDate() + ']'), 
      chalk.red(module.id || module), 
      Array.prototype.slice.call(arguments,1).join(' ')
    );
  }
}

function executeCommand(cmd, args, callback) {
  var command = spawn(cmd, args || [], {maxBuffer: 1024 * 500});

  command.stdout.on('data', function (data) {
    // console.log(data.toString());
    logger.log({id: cmd}, data.toString());

    if (data.toString().indexOf('File downloaded:') == 0) {
      processReport({
        downloaded: true,
        file: data.toString().replace('File downloaded: ','').split(' [')[0]
      });
    }
  });

  command.stderr.on('data', function (data) {
    // console.log(data.toString());
    logger.logError({id: cmd}, data.toString());
  });

  command.on('exit', function (code) {
    // console.log('command exited with code ' + code.toString());
    if (code !== 0) {
      logger.logError({id: cmd}, 'command exited with code ' + code.toString());
      callback(new Error('command exited with code ' + code.toString()));
    } else {
      logger.logInfo({id: cmd}, 'command exited with code ' + code.toString());
      callback();  
    }
  });
}

function downloadImage(download_args, done) {
  if (options.verbose) console.log('downloadImage');
  downloader.downloadImage(download_args.url, {
    output_dir: download_args.output_dir,
    skip_if_exist: true
  }, function(err, result) {
    if (err) {
      console.log(err);
    }
    if (result && result.file) {
      processReport({
        downloaded: true,
        file: result.file
      });
    }
    done();
  });
}

function downloadImgur(download_args, done) {
  if (options.verbose) console.log('downloadImgur');
  executeCommand('webdl', [
    download_args.url,
    download_args.output_dir,
    '--download-type=imgur',
    '--force',
    // '--group-by-site',
    '--imgur-no-gallery-dir',
    '--no-group'
  ], done);
}

function downloadGfycat(download_args, done) {
  if (options.verbose) console.log('downloadGfycat');
  var args = [
    download_args.url,
    download_args.output_dir,
    '--download-type=gfycat',
    '--force',
    // '--group-by-site',
    '--no-group'
  ];
  // if (options.gfycat_mp4) {
    args.push('--gfycat-mp4');
  // }
  if (options.gfycat_webm) {
    args.push('--gfycat-webm');
  }
  // args.push('--verbose');
  executeCommand('webdl', args, done);
}

var image_hosts = [
  'i.redd.it',
  'i.imgur.com',
  'i.reddituploads.com',
  'media.tumblr.com',
  'staticflickr.com',
  'media.giphy.com',
  'giant.gfycat.com'
];

var download_handlers = [
  {
    type: 'images',
    match: function(_url) {
      if (matchAny(_url, image_hosts)) return true;
      if (_url.indexOf('http://imgur.com/') == 0 
        && matchAny(path.extname(_url), ['.gif','.jpg','.png'])) {
        return true;
      }
      return false;
    },
    handler: downloadImage
  },
  {
    type: 'imgur',
    match: [
      'imgur.com', 
      'imgur.com/gallery', 
      'imgur.com/t/', 
      'imgur.com/r/',
      'imgur.com/a/',
    ],
    handler: downloadImgur
  },
  {
    type: 'gfycat',
    match: [
      'gfycat.com'
    ],
    handler: downloadGfycat
  },
];

function downloadPost(post, force) {

  var post_url = post.url;
  var post_title = post.title || '';

  // console.log('Post URL:', post_url);
  // console.log('Post title:', post_title);

  var downloaded_post = downloads_cache.get(post_url);
  if (!force && downloaded_post 
    && (downloaded_post.pending || downloaded_post.downloaded)) {
    return true;
  }

  var download_handler = null;
  
  for (var i = 0; i < download_handlers.length; i++) {
    if (isUrlMatch(post_url, download_handlers[i].match) && typeof download_handlers[i].handler == 'function') {
      if (options.images && download_handlers[i].type != 'images')  {
        continue;
      }
      if (options.imgur && download_handlers[i].type != 'imgur') {
        continue;
      }
      if (options.gfycat && download_handlers[i].type != 'gfycat') {
        continue;
      }
      download_handler = download_handlers[i].handler;
      break;
    }
  }

  if (download_handler) {
    if (options.verbose) console.log('Download:', post_url, post_title || '');

    var output_dir_name = utils.trimText(post_title || '#', 100);

    output_dir_name = utils.replaceAll(output_dir_name, '/', '%2F');
    output_dir_name = utils.replaceAll(output_dir_name, '\\', '%5C');
    output_dir_name = utils.replaceAll(output_dir_name, ':', '%3A');
    output_dir_name = utils.replaceAll(output_dir_name, '&amp;', '&');

    var first_char = output_dir_name[0];
    if (isAlpha(first_char)) first_char = first_char.toUpperCase();
    else first_char = '#';
    
    var download_output_dir = path.join(images_output_dir, first_char, output_dir_name);

    var post_str = '';
    post_str += 'URL: ' + post.url + '\n';
    post_str += 'Title: ' + post.title + '\n';
    if (post.author) {
      post_str += 'Author: u/' + post.author + '\n';
    }
    if (post.subreddit) {
      post_str += 'Subreddit: r/' + post.subreddit + '\n';
    }
    if (post.permalink) {
      post_str += 'Permalink: https://www.reddit.com' + post.permalink + '\n';
    }
    if (post.created) {
      var created_date = new Date();
      created_date.setTime(post.created*1000);
      post_str += 'Created date: ' + moment(created_date).format('DD MMM, YYYY hh:mm') + '\n';
    }
    post_str += '----\n';
    if (post.selftext) {
      post_str += post.selftext;
      post_str += '----\n';
    }

    downloads_cache.update(post_url, {
      title: post_title,
      pending: true
    });

    download_queue.pushJob({
      url: post_url, 
      title: post_title,
      desc: post_str,
      output_dir: download_output_dir
    }, function(args, done) {

      var post_file = path.join(args.output_dir,'post.txt');
      var post_str = '';
      if (utils.fileExists(post_file)) {
        post_str = utils.loadFileSync(post_file);
      }
      post_str += args.desc;

      utils.saveFileSync(post_file, post_str);

      download_handler({url: args.url, output_dir: args.output_dir}, done);

    }, function(err) {
      if (err) {
        console.log(err);
        downloads_cache.update(post_url, {
          pending: false,
          download_error: err.message,
          downloaded: true
        });
      } else {
        downloads_cache.update(post_url, {
          pending: false,
          downloaded: true,
          downloaded_at: new Date()
        });
      }
      console.log('Download queue:', download_queue.jobCount());
    });
    return true;
  }

  return false;
}

///

function processReport(data) {
  if (typeof process.send == 'function') {
    process.send(data);
  }
}

function printStats() {

}

function gracefulShutdown() {
  console.log('');
  console.log('Exiting... Please wait');
  printStats();
  console.log('Done.');
  process.exit();
}

function _processPendingDownloads() {
  for (var post_url in downloads_cache.toMap()) {
    var download = downloads_cache.get(post_url);
    if (download && download.pending) {
      if (options.verbose) console.log('Pending:', post_url);
      downloadPost({
        url: post_url,
        title: download.title
      }, true);
    }
  }
}

function _exportAndDownloadPosts(options, done) {

  downloads_cache = new JsonStore({ file: path.join(data_dir, 'downloads.json') });

  var exported_posts_file = options.exported_posts_file || path.join(data_dir, 'posts-exported.json');
  if (!utils.fileExists(exported_posts_file)) {
    console.log(chalk.red('Exported posts file does not exist'));
    return done(new Error('Exported posts file does not exist'));
  }

  var favorite_posts_file = options.favorite_posts_file || path.join(data_dir, 'favorites.json');
  if (options.favorites && utils.fileExists(favorite_posts_file)) {
    favorites_cache = utils.loadFromJsonFile(favorite_posts_file);
  }

  _processPendingDownloads();

  var posts_count = 0;
  var exported_posts = utils.loadFromJsonFile(exported_posts_file);
  for (var post_id in exported_posts) {
    posts_count++;
    if (options.favorites && !favorites_cache[post_id]) {
      continue;
    }
    downloadPost(exported_posts[post_id]);
  }

  console.log('Posts count:', posts_count);

  done();
}

function _downloadPosts(options, done) {

  downloads_cache = new JsonStore({ file: path.join(data_dir, 'downloads.json') });

  var posts_cache = new JsonStore({ file: path.join(data_dir, 'posts.json') });
  var posts_store = new NeDB({
    filename: path.join(data_dir, 'posts.db'),
    autoload: true
  });

  var favorite_posts_file = options.favorite_posts_file || path.join(data_dir, 'favorites.json');
  if (options.favorites && utils.fileExists(favorite_posts_file)) {
    favorites_cache = utils.loadFromJsonFile(favorite_posts_file);
  }

  var post_ids = [];
  for (var post_id in posts_cache.toMap()) {
    if (options.favorites && !favorites_cache[post_id]) {
      continue;
    }
    post_ids.push(post_id);
  }

  console.log('Posts count:', post_ids.length);

  _processPendingDownloads();

  var count = 0;
  var total = post_ids.length;
  async.eachSeries(post_ids, function(post_id, cb) {
    count++;
    // console.log('Progress:', count + '/' + total, post_id);
    posts_store.findOne({id: post_id}, function(err, post) {
      if (err) {
        console.log('Export post failed:', post_id);
        return cb(err);
      }
      if (post) downloadPost(post);
      cb();
    });
  }, function(err) {
    if (err) {
      console.log(err);
      return done(err);
    } else {
      done();
    }
  });
}

if (options.exported_posts) {
  lockFile.lock(path.join(data_dir, 'reddit.lock'), {}, function (err) {
    if (err) {
      console.log(err);
      process.exit(1);
    }

    process.on('exit', function() {
      lockFile.unlock(path.join(data_dir, 'reddit.lock'), function (err) {
        if (err) {
          console.log(err);
        }
      });
    });

    _exportAndDownloadPosts(options, function(err) {
      if (err) {
        console.log(err);
        process.exit(1);
      }
    });
  });
} else {
  lockFile.lock(path.join(data_dir, 'reddit.lock'), {}, function (err) {
    if (err) {
      console.log(err);
      process.exit(1);
    }

    process.on('exit', function() {
      lockFile.unlock(path.join(data_dir, 'reddit.lock'), function (err) {
        if (err) {
          console.log(err);
        }
      });
    });

    _downloadPosts(options, function(err) {
      if (err) {
        console.log(err);
        process.exit(1);
      }
    });
  });
}

