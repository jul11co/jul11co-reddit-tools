// lib/post-downloader.js

var async = require('async');
var path = require('path');
var chalk = require('chalk');
var moment = require('moment');

var spawn = require('child_process').spawn;

var JobQueue = require('jul11co-jobqueue');
var JsonStore = require('jul11co-jsonstore');

var utils = require('jul11co-utils');
var downloader = require('jul11co-wdt').Downloader;

module.exports = function(output_dir, options) {

  var downloads_cache = new JsonStore({ file: path.join(output_dir, 'downloads.json') });
  var images_output_dir = options.images_output_dir || path.join(output_dir, 'images');

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

  function processReport(data) {
    if (typeof process.send == 'function') {
      process.send(data);
    }
  }

  function executeCommand(cmd, args, opts, callback) {
    if (typeof opts == 'function') {
      callback = opts;
      opts = {};
    }
    var command = spawn(cmd, args || [], {maxBuffer: 1024 * 500});

    command.stdout.on('data', function (data) {
      // console.log(data.toString());
      if (opts.verbose || opts.progress) logger.log({id: cmd}, data.toString());

      if (data.toString().indexOf('File downloaded:') == 0) {
        processReport({
          downloaded: true,
          file: data.toString().replace('File downloaded: ','').split(' [')[0]
        });
      }
    });

    command.stderr.on('data', function (data) {
      // console.log(data.toString());
      if (opts.verbose || opts.progress) logger.logError({id: cmd}, data.toString());
    });

    command.on('exit', function (code) {
      // console.log('command exited with code ' + code.toString());
      if (code !== 0) {
        if (opts.verbose || opts.progress) logger.logError({id: cmd}, 'command exited with code ' + code.toString());
        callback(new Error('command exited with code ' + code.toString()));
      } else {
        if (opts.verbose || opts.progress) logger.logInfo({id: cmd}, 'command exited with code ' + code.toString());
        callback();  
      }
    });
  }

  function downloadImage(download_args, download_opts, done) {
    if (typeof download_opts == 'function') {
      callback = download_opts;
      download_opts = {};
    }
    if (download_opts.verbose) console.log('downloadImage');
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

  this.downloadImage = downloadImage;

  function downloadImgur(download_args, download_opts, done) {
    if (typeof download_opts == 'function') {
      callback = download_opts;
      download_opts = {};
    }
    if (download_opts.verbose) console.log('downloadImgur');
    executeCommand('webdl', [
      download_args.url,
      download_args.output_dir,
      '--download-type=imgur',
      '--force',
      // '--group-by-site',
      '--imgur-no-gallery-dir',
      '--no-group'
    ], download_opts, done);
  }

  this.downloadImgur = downloadImgur;

  function downloadGfycat(download_args,download_opts,  done) {
    if (typeof download_opts == 'function') {
      callback = download_opts;
      download_opts = {};
    }
    if (download_opts.verbose) console.log('downloadGfycat');
    var args = [
      download_args.url,
      download_args.output_dir,
      '--download-type=gfycat',
      '--force',
      // '--group-by-site',
      '--no-group'
    ];
    // if (download_opts.gfycat_mp4) {
      args.push('--gfycat-mp4');
    // }
    if (download_opts.gfycat_webm) {
      args.push('--gfycat-webm');
    }
    // args.push('--verbose');
    executeCommand('webdl', args, download_opts, done);
  }

  this.downloadGfycat = downloadGfycat;

  var image_hosts = [
    'i.redd.it',
    'i.imgur.com',
    'i.reddituploads.com',
    'media.tumblr.com',
    'staticflickr.com',
    'media.giphy.com',
    'giant.gfycat.com',
    'pbs.twimg.com'
  ];

  var download_handlers = [
    {
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
      match: [
        'gfycat.com'
      ],
      handler: downloadGfycat
    },
  ];

  function downloadPost(post, opts, callback) {
    if (typeof opts == 'function') {
      callback = opts;
      opts = {};
    }

    var post_url = post.url;
    var post_title = post.title || '';

    // console.log('Post URL:', post_url);
    // console.log('Post title:', post_title);

    var downloaded_post = downloads_cache.get(post_url);
    if (!opts.force && downloaded_post 
      && (downloaded_post.pending || downloaded_post.downloaded)) {
      return callback();
    }

    var download_handler = null;
    
    for (var i = 0; i < download_handlers.length; i++) {
      if (isUrlMatch(post_url, download_handlers[i].match)
        && typeof download_handlers[i].handler == 'function') {
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

        download_handler({url: args.url, output_dir: args.output_dir}, opts, done);

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

        if (options.verbose) console.log('Download queue:', download_queue.jobCount());

        return callback(err);
      });
    } else {
      return callback();
    }
  }

  this.downloadPost = downloadPost;
}
