#!/usr/bin/env node

var path = require('path');
var fs = require('fs');

var chalk = require('chalk');
var async = require('async');
var moment = require('moment');

var utils = require('jul11co-utils');
var JobQueue = require('jul11co-jobqueue');

var spawn = require('child_process').spawn;
var fork = require('child_process').fork;

var NRP = require('node-redis-pubsub');

var prettySeconds = require('pretty-seconds');
var Spinner = require('cli-spinner').Spinner;

var spinner = new Spinner('%s');
spinner.setSpinnerString('|/-\\');

function printUsage() {
  console.log('Usage:');
  console.log('       reddit-scrape-bot --start [data-dir] [--download-posts] [--export-ports]');
  console.log('       reddit-scrape-bot --list [data-dir]');
  console.log('');
  console.log('Set custom path to sources.json');
  console.log('       reddit-scrape-bot [...] --sources-file <path-to-sources.json>');
  console.log('');
}

if (process.argv.length < 3) {
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

if (typeof options.scrape_interval == 'string') {
  options.scrape_interval = parseInt(options.scrape_interval);
  if (isNaN(options.scrape_interval)) {
    console.log(chalk.red('invalid scrape interval'));
    process.exit();
  }
}

if (typeof options.scrape_delay == 'string') {
  options.scrape_delay = parseInt(options.scrape_delay);
  if (isNaN(options.scrape_delay)) {
    console.log(chalk.red('invalid scrape interval'));
    process.exit();
  }
}

var default_scrape_delay = 5; // 5 secs
var default_scrape_interval = 60*30; // 30 minutes

var scrape_queue = new JobQueue();
var download_queue = new JobQueue();
var update_queue = new JobQueue();

var sources_store = {};
var reddit_sources = {};

var nrp = null;

if (options.support_add) {
  nrp = new NRP({
    port: 6379,       // Port of your locally running Redis server
    scope: 'reddit'   // Use a scope to prevent two NRPs from sharing messages
  });

  nrp.on("error", function(err){
    if (err && err.message) console.log('NRP Error:', err.message);
  });
}

process.on('SIGINT', function() {
  console.log("\nCaught interrupt signal");
  if (nrp) nrp.quit();
  process.exit();
});

///

function getSubreddit(reddit_url) {
  return reddit_url
    .replace('http://reddit.com/r/', '')
    .replace('http://www.reddit.com/r/', '')
    .replace('https://www.reddit.com/r/', '')
    .split('/')[0].trim();
}

function timeStamp() {
  return moment().format('YYYY/MM/DD hh:mm');
}

function directoryExists(directory) {
  try {
    var stats = fs.statSync(directory);
    if (stats.isDirectory()) {
      return true;
    }
  } catch (e) {
  }
  return false;
}

function getDateString(date) {
  return moment(date).fromNow();
}

function saveJsonFileSafe(data, target_file) {
  var current_data = {};
  if (utils.fileExists(target_file)) {
    current_data = utils.loadFromJsonFile(target_file);
  }
  current_data = Object.assign(current_data, data);
  utils.saveToJsonFile(current_data, target_file);
}

function leftPad(str, spaces) {
  if (!str) return '';
  if (str.length >= spaces) return str;
  while (str.length < spaces) {
    str = ' ' + str;
  }
  return str;
}

function rightPad(str, spaces) {
  if (!str) return '';
  if (str.length >= spaces) return str;
  while (str.length < spaces) {
    str += ' ';
  }
  return str;
}

var lastChar = function(str) {
  return str.substring(str.length-1);
}

var removeLastChar = function(str) {
  return str.substring(0, str.length-1);
}

function executeCommand(cmd, args, callback) {
  if (!options.verbose) spinner.start();
  var command = spawn(cmd, args || [], {maxBuffer: 1024 * 500});

  if (options.verbose) {
    command.stdout.on('data', function (data) {
      console.log(chalk.yellow(cmd), data.toString());
    });

    command.stderr.on('data', function (data) {
      console.log(chalk.yellow(cmd), data.toString());
    });
  }

  command.on('exit', function (code) {
    if (!options.verbose) spinner.stop(true);
    if (options.verbose) console.log(chalk.yellow(cmd), 'command exited with code ' + code.toString());
    if (code !== 0) {
      callback(new Error('command exited with code ' + code.toString()));
    } else {
      callback();  
    }
  });
}

function executeScript(script, args, callback) {
  if (!options.verbose) spinner.start();

  var cmd = path.basename(script,'.js');
  var command = fork(script, args || [], {silent: true});
  var start_time = new Date();

  if (options.debug) {
    command.stdout.on('data', function (data) {
      console.log(chalk.grey(timeStamp()), chalk.yellow(cmd), data.toString());
    });

    command.stderr.on('data', function (data) {
      console.log(chalk.grey(timeStamp()), chalk.yellow(cmd), data.toString());
    });
  }

  command.on('message', function(data) {
    if (data.downloaded && data.file) {
      if (spinner.isSpinning()) spinner.stop(true);
      console.log(chalk.grey(timeStamp()), chalk.magenta('downloaded'), data.file);
      spinner.start();
    } 
    if (data.new_post && data.post_info && options.new_post) {
      if (spinner.isSpinning()) spinner.stop(true);
      console.log(chalk.grey(timeStamp()), chalk.green('new post'), 
        chalk.grey(getDateString(new Date(data.post_info.created_utc*1000))), 
        // chalk.blue(data.post_info.permalink),
        chalk.blue('r/' + data.post_info.subreddit + '/comments/' + data.post_info.id), 
        data.post_info.title);
      spinner.start();
    } 
    else if (data.progress) {
      if (typeof data.scraped_posts_count != 'undefined') {
        if (spinner.isSpinning()) spinner.stop(true);
        console.log(chalk.grey(timeStamp()), chalk.blue('progress'), 
          'scraped: ' + data.scraped_posts_count, 'new: ' + data.new_posts_count);
        spinner.start();
      }
    }
    else if (data.scraped_stats) {
      if (typeof data.new_posts_count != 'undefined') {
        if (spinner.isSpinning()) spinner.stop(true);
        console.log(chalk.grey(timeStamp()), chalk.bold('new posts'), data.new_posts_count);
        spinner.start();
      }
    }
  });

  command.on('exit', function (code) {
    if (!options.verbose) spinner.stop(true);
    if (options.verbose) {
      console.log(chalk.grey(timeStamp()), 
        chalk.yellow(cmd), 'command exited with code ' + code.toString());
    }
    var elapsed_seconds = moment().diff(moment(start_time),'seconds');
    console.log(chalk.grey(timeStamp()), chalk.magenta('elapsed time'), prettySeconds(elapsed_seconds));
    if (code !== 0) {
      callback(new Error('command exited with code ' + code.toString()));
    } else {
      callback();  
    }
  });
}

///

function scrapeSubreddit(url, output_dir, done) {
  var args = [
    url,
    output_dir,
  ];
  args.push('--stop-if-no-new-posts');
  // args.push('--verbose');
  // executeCommand('reddit-api-scrape', args, done);
  executeScript(__dirname + '/reddit-api-scrape.js', args, done);
}

function exportPosts(data_dir, done) {
  var args = [
    data_dir,
  ];
  // args.push('--verbose');
  executeCommand('reddit-export-posts', args, done);
}

function downloadSubredditPosts(data_dir, done) {
  var args = [
    data_dir,
  ];
  args.push('--exported-posts');
  // args.push('--verbose');
  // executeCommand('reddit-download-posts', args, done);
  executeScript(__dirname + '/reddit-download-posts.js', args, done);
}

///

function downloadPosts(source, output_dir) {
  download_queue.pushJob(source, function(source, done) {
    var subreddit = getSubreddit(source.url);
    var subreddit_output_dir = path.join(output_dir, 'r', subreddit);

    console.log(chalk.grey(timeStamp()), chalk.magenta('download posts'), 'r/'+subreddit);

    downloadSubredditPosts(subreddit_output_dir, function(err) {
      if (err) {
        console.log(chalk.grey(timeStamp()), chalk.red('download posts failed.'), 'r/'+subreddit);
        return done(err);
      }
      setTimeout(done, 1000);
      // cb();
    });
  }, function(err) {
    if (err) console.log(err);

    // console.log('');
    console.log(chalk.grey(timeStamp()), 'download queue', (download_queue.jobCount()-1));
  });
}

function scrapeSource(source_url, output_dir) {
  scrape_queue.pushJob({url: source_url}, function(source, done) {

    if (reddit_sources[source.url] && reddit_sources[source.url].updating) {
      console.log(chalk.grey(timeStamp()), 'already updating:', source.url);
      return done();
    } else if (!reddit_sources[source.url]) {
      reddit_sources[source.url] = {};
    }
    reddit_sources[source.url].updating = true;

    if (options.verbose) {
      console.log(chalk.grey(timeStamp()), chalk.cyan('scrape source'), source.url);
    }

    var subreddit = getSubreddit(source.url);

    if (sources_store[source.url] && sources_store[source.url].last_scraped) {
      var last_scraped = sources_store[source.url].last_scraped;
      if (typeof last_scraped == 'string') {
        console.log(chalk.grey(timeStamp()), 'last scraped (string):', subreddit, last_scraped);
        last_scraped = new Date(last_scraped);
      }
      
      var source_scrape_interval = (sources_store[source.url].scrape_interval || default_scrape_interval) * 1000;
      var now = new Date();
      if (now.getTime() - last_scraped.getTime() < source_scrape_interval) {
        console.log(chalk.grey(timeStamp()), 'last scraped:', subreddit, moment(last_scraped).fromNow());
        return done();
      }
    }

    var source_scrape_delay = (sources_store[source.url].scrape_delay || default_scrape_delay) * 1000;

    console.log(chalk.grey(timeStamp()), chalk.magenta('scrape'), 'r/'+subreddit);

    scrapeSubreddit(source.url, output_dir, function(err) {
      if (err) {
        console.log(chalk.grey(timeStamp()), chalk.red('scrape failed.'), 'r/'+subreddit);
        return done(err);
      }

      if (sources_store[source.url]) {
        sources_store[source.url].last_scraped = new Date();
      }

      if (!sources_store[source.url].no_export && (options.download_posts || options.export_posts)) {
        var subreddit_output_dir = path.join(output_dir, 'r', subreddit);

        console.log(chalk.grey(timeStamp()), chalk.magenta('export posts'), 'r/'+subreddit);
        exportPosts(subreddit_output_dir, function(err) {
          if (err) {
            console.log(err);
            return done();
          }

          if (sources_store[source.url].download_posts && options.download_posts) {
            downloadPosts(source, output_dir);
          }

          setTimeout(done, source_scrape_delay);
        });
      } else {
        setTimeout(done, source_scrape_delay);
      }
      // cb();
    });
  }, function(err) {
    if (err) console.log(err);

    reddit_sources[source_url].updating = false;

    if (options.sources_file) {
      // utils.saveToJsonFile(sources_store, options.sources_file);
      saveJsonFileSafe(sources_store, options.sources_file);
    }

    // console.log('');
    console.log(chalk.grey(timeStamp()), 'scrape queue', (scrape_queue.jobCount()-1));
  });
}

///

function loadSourcesFromDir(data_dir) {
  var files = fs.readdirSync(path.join(data_dir, 'r'));
  for (var i = 0; i < files.length; i++) {
    var subreddit_config_file = path.join(data_dir, 'r', files[i], 'reddit.json');
    
    if (utils.fileExists(subreddit_config_file)) {
      // console.log('Load subreddit:', subreddit_config_file);
      var reddit_info = utils.loadFromJsonFile(subreddit_config_file) || {};
      for (var subreddit_url in reddit_info) {
        if (!sources_store[subreddit_url]) {
          sources_store[subreddit_url] = reddit_info[subreddit_url];
          console.log('Added subreddit:', subreddit_url);
        }
      }
    }
  }
}

function saveSourceConfig(source_url, souce_config, output_dir) {
  var subreddit = getSubreddit(source_url);
  var subreddit_data_dir = path.join(output_dir, 'r', subreddit);

  utils.ensureDirectoryExists(subreddit_data_dir);

  var subreddit_config_file = path.join(subreddit_data_dir, 'reddit.json');
  var reddit_info = {};
  if (utils.fileExists(subreddit_config_file)) {
    reddit_info = utils.loadFromJsonFile(subreddit_config_file) || {};
  }

  if (!reddit_info[source_url]) {
    reddit_info[source_url] = souce_config;
    console.log('Add subreddit:', source_url);
  } else {
    reddit_info[source_url] = Object.assign(reddit_info[source_url], souce_config);
    console.log('Update subreddit:', source_url);
  }

  // utils.saveToJsonFile(reddit_info, subreddit_config_file);
  saveJsonFileSafe(reddit_info, subreddit_config_file);
}

function showSourceConfig(source_config) {
  for (var config_key in source_config) {
    if (config_key == 'added_at' || config_key == 'last_scraped') {
      var time_moment = moment(source_config[config_key]);
      console.log(chalk.green(leftPad(rightPad(config_key+':', 17),23)) 
        + time_moment.format('MMM DD, YYYY hh:mm A') + ' (' + time_moment.fromNow() + ')');
    } else {
      console.log(chalk.green(leftPad(rightPad(config_key+':', 17),23)) + source_config[config_key]);
    }
  }
}

////

function sortSources(sources, sort_field, sort_order) {
  if (sort_order=='desc') {
    sources.sort(function(a,b) {
      if (!b.config[sort_field]) return -1;
      else if (!a.config[sort_field]) return 1;
      else if (a.config[sort_field] > b.config[sort_field]) return -1;
      else if (a.config[sort_field] < b.config[sort_field]) return 1;
      return 0;
    });
  } else {
    sources.sort(function(a,b) {
      if (!b.config[sort_field]) return 1;
      else if (!a.config[sort_field]) return -1;
      else if (a.config[sort_field] > b.config[sort_field]) return 1;
      else if (a.config[sort_field] < b.config[sort_field]) return -1;
      return 0;
    });
  }
}

function _listSources() {
  var sources = [];
  for (var source_url in sources_store) {
    sources.push({
      url: source_url, 
      name: source_url.replace('https://www.reddit.com/',''),
      config: sources_store[source_url]
    });
  }

  if (options.sort == 'url' || options.sort == 'name' 
    || options.sort == 'added_at' || options.sort == 'last_scraped') {

    var sort_field = options.sort;
    var default_order = (sort_field == 'added_at' || sort_field == 'last_scraped') ? 'desc' : 'asc';
    var sort_order = options.order || default_order;

    console.log('----');
    console.log('Sort by:', sort_field, 'order:', sort_order);
    sources.forEach(function(source) {
      if (source.config[sort_field] && (sort_field == 'added_at' || sort_field == 'last_scraped')) {
        source.config[sort_field] = new Date(source.config[sort_field]).getTime();
      }
      // console.log(source.config[sort_field]);
    });
    if (options.sort == 'added_at' || options.sort == 'last_scraped') {
      sortSources(sources, sort_field, sort_order);
    } else {
      if (sort_order=='desc') {
        sources.sort(function(a,b) {
          if (a[sort_field] > b[sort_field]) return -1;
          else if (a[sort_field] < b[sort_field]) return 1;
          return 0;
        });
      } else {
        sources.sort(function(a,b) {
          if (a[sort_field] > b[sort_field]) return 1;
          else if (a[sort_field] < b[sort_field]) return -1;
          return 0;
        });
      }
    }
  }
  console.log('----');

  var index = 0;
  sources.forEach(function(source) {
    index++;
    console.log(leftPad('' + index, 2) + '. ' + chalk.blue(source.name));
    showSourceConfig(source.config);
  });
}

function scrapeSourcePeriodically(source_url, output_dir, interval) {
  setInterval(function() {
    scrapeSource(source_url, output_dir);
  }, interval);

  scrapeSource(source_url, output_dir);
}

function _updateSources(output_dir) {
  var source_urls = [];
  for (var source_url in sources_store) {
    if (!sources_store[source_url].disable) {
      source_urls.push(source_url);
    }
  }

  for (var i = 0; i < source_urls.length; i++) {
    var source_scrape_interval = sources_store[source_urls[i]].scrape_interval || options.scrape_interval || default_scrape_interval;
    scrapeSourcePeriodically(source_urls[i], output_dir, source_scrape_interval * 1000); // to ms
  }
}

function _updateSource(source_url, output_dir) {
  var source = {
    url: source_url
  };

  var source_is_new = false;

  if (sources_store[source_url]) {
    console.log(chalk.grey(timeStamp()), chalk.magenta('already added'), source_url);
    
    var source_config = sources_store[source_url];
    var update_source = false;

    if (options.scrape_interval && source_config.scrape_interval != options.scrape_interval) {
      source_config.scrape_interval = options.scrape_interval;
      update_source = true;
    }
    if (options.download_posts && source_config.download_posts != options.download_posts) {
      source_config.download_posts = true;
      update_source = true;
    }
    if (options.nsfw && !source_config.nsfw) {
      source_config.nsfw = true;
      update_source = true;
    }
    if (options.sfw && source_config.nsfw) {
      delete source_config.nsfw;
      update_source = true;
    }

    if (update_source) {
      sources_store[source_url] = source_config;
      saveSourceConfig(source_url, source_config, output_dir);
    }
  } else {
    console.log(chalk.grey(timeStamp()), chalk.green('new source'), source_url);
    
    source_is_new = true;

    var source_config = {
      added_at: new Date()
    };
    if (options.scrape_interval) source_config.scrape_interval = options.scrape_interval;
    if (options.download_posts) source_config.download_posts = true;
    if (options.nsfw) source_config.nsfw = true;

    sources_store[source_url] = source_config;
    saveSourceConfig(source_url, source_config, output_dir);
  }

  if (source_is_new) {
    var source_scrape_interval = sources_store[source_url].scrape_interval || options.scrape_interval || default_scrape_interval;
    scrapeSourcePeriodically(source_url, output_dir, source_scrape_interval * 1000); // to ms
  } else {
    scrapeSource(source_url, output_dir);
  }
}

////

if (options.start) {
  console.log(chalk.grey(timeStamp()), chalk.cyan('scrape from sources'));

  var output_dir = argv[0] || '.';

  options.sources_file = options.sources_file || path.join(output_dir, 'sources.json');
  if (options.sources_file && utils.fileExists(options.sources_file)) {
    sources_store = utils.loadFromJsonFile(options.sources_file);
  } 
  // else if (directoryExists(path.join(output_dir, 'r'))) {
  //   loadSourcesFromDir(output_dir);
  // }

  process.on('exit', function() {
    // utils.saveToJsonFile(sources_store, options.sources_file);
    saveJsonFileSafe(sources_store, options.sources_file);
  });

  if (nrp && options.support_add) {
    nrp.on('reddit:new-subreddit', function(data) {
      console.log('Event [reddit:new-subreddit] - ' + data.subreddit);

      if (data.subreddit) {
        console.log('add subreddit: ' + data.subreddit);
        _updateSource('https://www.reddit.com/r/' + data.subreddit, output_dir);
      }
    });
  }

  _updateSources(output_dir);
} 
else if (options.list || options.list_sources) {
  console.log(chalk.grey(timeStamp()), chalk.cyan('reddit sources'));

  var output_dir = argv[0] || '.';

  options.sources_file = options.sources_file || path.join(output_dir, 'sources.json');
  if (options.sources_file && utils.fileExists(options.sources_file)) {
    sources_store = utils.loadFromJsonFile(options.sources_file);
  }
  
  _listSources();

  process.exit();
} else {
  printUsage();
  process.exit();
}

