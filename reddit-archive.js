#!/usr/bin/env node

var path = require('path');
var fs = require('fs');
var chalk = require('chalk');
var async = require('async');
var moment = require('moment');

var lockFile = require('lockfile');

var utils = require('jul11co-utils');
var JobQueue = require('jul11co-jobqueue');

var spawn = require('child_process').spawn;
var fork = require('child_process').fork;

var prettySeconds = require('pretty-seconds');

// var Spinner = require('cli-spinner').Spinner;

// var spinner = new Spinner('%s');
// spinner.setSpinnerString('|/-\\');

function printUsage() {
  console.log('Usage: ');
  console.log('       reddit-archive <URL | r/SUBREDDIT> [--nsfw] [OPTIONS]');
  console.log('');
  console.log('       reddit-archive --update [--nsfw] [OPTIONS]');
  console.log('       reddit-archive --list [--nsfw]');
  console.log('       reddit-archive --add <URL> [--scrape-interval=<SECONDS>] [--nsfw] [OPTIONS]');
  console.log('       reddit-archive --remove <URL>');
  console.log('');
  console.log('       reddit-archive --import <URL>');
  console.log('       reddit-archive --import --from-html <HTML-FILE>');
  console.log('');
  console.log('OPTIONS:');
  console.log('       --sources-file <path-to-sources.json>  : Set custom path to sources.json');
  console.log('       --download-posts                       : Download posts');
  console.log('       --export-posts                         : Export posts');
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

process.on('SIGINT', function() {
  console.log("\nCaught interrupt signal");
  process.exit();
});

var verbose = false;
if (process.argv.indexOf('--verbose') != -1) {
  verbose = true;
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

var sources_store = {};
var reddit_sources = {};

///

function getSubreddit(reddit_url) {
  return reddit_url
    .replace('http://reddit.com/r/', '')
    .replace('http://www.reddit.com/r/', '')
    .replace('https://www.reddit.com/r/', '')
    .split('/')[0].trim();
}

function timeStamp() {
  if (options.simple_log) return '';
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

function executeCommand(cmd, args, callback) {
  // if (!options.verbose) spinner.start();
  var command = spawn(cmd, args || [], {maxBuffer: 1024 * 500});

  if (options.debug) {
    command.stdout.on('data', function (data) {
      console.log(chalk.yellow(cmd), data.toString());
    });

    command.stderr.on('data', function (data) {
      console.log(chalk.yellow(cmd), data.toString());
    });
  }

  command.on('exit', function (code) {
    // if (!options.verbose) spinner.stop(true);
    if (options.verbose) {
      console.log(chalk.yellow(cmd), 'command exited with code ' + code.toString());
    }
    if (code !== 0) {
      callback(new Error('command exited with code ' + code.toString()));
    } else {
      callback();  
    }
  });
}

function getDateString(date) {
  return moment(date).fromNow();
}

function executeScript(script, args, callback) {
  // if (!options.verbose) spinner.start();
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
      // if (spinner.isSpinning()) spinner.stop(true);
      console.log(chalk.grey(timeStamp()), chalk.magenta('downloaded'), data.file);
      // spinner.start();
    } 
    else if (data.new_post && data.post_info && options.new_post) {
      // if (spinner.isSpinning()) spinner.stop(true);
      console.log(chalk.grey(timeStamp()), chalk.green('new post'), 
        chalk.grey(getDateString(new Date(data.post_info.created_utc*1000))), 
        // chalk.blue(data.post_info.permalink),
        chalk.blue('r/' + data.post_info.subreddit + '/comments/' + data.post_info.id), 
        data.post_info.title);
      // spinner.start();
    } 
    else if (data.progress) {
      if (typeof data.scraped_posts_count != 'undefined') {
        // if (spinner.isSpinning()) spinner.stop(true);
        console.log(chalk.grey(timeStamp()), chalk.blue('progress'), 
          'scraped: ' + data.scraped_posts_count, 'new: ' + data.new_posts_count);
        // spinner.start();
      }
    }
    else if (data.scraped_stats) {
      if (typeof data.new_posts_count != 'undefined') {
        // if (spinner.isSpinning()) spinner.stop(true);
        console.log(chalk.grey(timeStamp()), chalk.bold('new posts'), data.new_posts_count);
        // spinner.start();
      }
    }
  });

  command.on('exit', function (code) {
    // if (!options.verbose) spinner.stop(true);
    if (options.verbose) {
      console.log(chalk.grey(timeStamp()), 
        chalk.yellow(cmd), 'command exited with code ' + code.toString());
    }
    var elapsed_seconds = moment().diff(moment(start_time),'seconds');
    console.log(chalk.grey(timeStamp()), chalk.grey('elapsed time'), prettySeconds(elapsed_seconds));
    if (code !== 0) {
      callback(new Error('command exited with code ' + code.toString()));
    } else {
      callback();  
    }
  });
}

function scrapeSubreddit(url, output_dir, done) {
  var args = [
    url,
    output_dir,
  ];
  args.push('--stop-if-no-new-posts'); // same as -S
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
  // args.push('--exported-posts');
  // args.push('--verbose');
  // executeCommand('reddit-download-posts', args, done);
  executeScript(__dirname + '/reddit-download-posts.js', args, done);
}

function saveJsonFileSafe(data, target_file) {
  var current_data = {};
  if (utils.fileExists(target_file)) {
    current_data = utils.loadFromJsonFile(target_file);
  }
  current_data = Object.assign(current_data, data);
  utils.saveToJsonFile(current_data, target_file);
}

///

function updateSource(source, output_dir) {
  if (reddit_sources[source.url] && reddit_sources[source.url].updating) {
    return;
  } else if (!reddit_sources[source.url]) {
    reddit_sources[source.url] = {};
  }
  reddit_sources[source.url].updating = true;

  var skip_update = false;
  scrape_queue.pushJob(source, function(source, done) {
    
    var subreddit = getSubreddit(source.url);
    console.log(chalk.grey(timeStamp()), chalk.cyan('update'), 'r/'+subreddit);

    if (source.config && source.config.last_scraped) {
      var last_scraped = source.config.last_scraped;
      if (typeof last_scraped == 'string') {
        last_scraped = new Date(last_scraped);
      }
      
      var source_scrape_interval = (source.config.scrape_interval 
        || options.scrape_interval || default_scrape_interval) * 1000;
      var now = new Date();
      console.log(chalk.grey(timeStamp()), chalk.grey('last scraped'), subreddit, moment(last_scraped).fromNow());

      if (!options.force && now.getTime() - last_scraped.getTime() < source_scrape_interval) {
        skip_update = true;
        return done();
      }
    }

    console.log(chalk.grey(timeStamp()), chalk.magenta('scrape'), 'r/'+subreddit);

    scrapeSubreddit(source.url, output_dir, function(err) {
      if (err) {
        console.log(chalk.grey(timeStamp()), chalk.red('update failed.'), 'r/'+subreddit);
        return done(err);
      }

      if (source.config) source.config.last_scraped = new Date();

      if (!source.config.no_export && (options.download_posts || options.export_posts)) {
        var subreddit_output_dir = path.join(output_dir, 'r', subreddit);

        console.log(chalk.grey(timeStamp()), chalk.magenta('export posts'), 'r/'+subreddit);
        exportPosts(subreddit_output_dir, function(err) {
          if (err) {
            console.log(err);
            return done();
          }

          if (source.config.download_posts && options.download_posts) {
            download_queue.pushJob(source, function(source, done2) {
              console.log(chalk.grey(timeStamp()), chalk.magenta('download posts'), 'r/'+subreddit);

              downloadSubredditPosts(subreddit_output_dir, function(err) {
                if (err) {
                  console.log(chalk.grey(timeStamp()), chalk.red('download posts failed.'), 'r/'+subreddit);
                  return done2(err);
                }
                setTimeout(done2, 1000);
                // cb();
              });
            }, function(err) {
              if (err) console.log(err);

              // console.log('');
              console.log(chalk.grey(timeStamp()), 'download queue', (download_queue.jobCount()-1));
            });
          }

          setTimeout(done, (source.config.scrape_delay || default_scrape_delay) * 1000);
        });
      } else {
        setTimeout(done, (source.config.scrape_delay || default_scrape_delay) * 1000);
      }
      // cb();
    });
  }, function(err) {
    if (err) console.log(err);

    reddit_sources[source.url].updating = false;

    if (!skip_update && options.sources_file) {
      // utils.saveToJsonFile(sources_store, options.sources_file);
      saveJsonFileSafe(sources_store, options.sources_file);
    }

    // console.log('');
    // console.log('scrape queue', (scrape_queue.jobCount()-1));
  });
}

function updateSourcePeriodically(source, output_dir, interval) {
  setInterval(function() {
    updateSource(source, output_dir);
  }, interval);

  updateSource(source, output_dir);
}

function loadSourcesFromDir(data_dir) {
  if (utils.fileExists(path.join(data_dir, 'reddit.json'))) {
    // console.log('Load subreddit:', path.join(data_dir, 'reddit.json'));
    var reddit_info = utils.loadFromJsonFile(path.join(data_dir, 'reddit.json')) || {};
    for (var subreddit_url in reddit_info) {
      if (!sources_store[subreddit_url]) {
        sources_store[subreddit_url] = reddit_info[subreddit_url];
        console.log('Added subreddit:', subreddit_url);
      }
    }
  }
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

function saveSourceConfig(source_url, source_config, output_dir) {
  var subreddit = getSubreddit(source_url);
  var subreddit_data_dir = path.join(output_dir, 'r', subreddit);

  utils.ensureDirectoryExists(subreddit_data_dir);

  var subreddit_config_file = path.join(subreddit_data_dir, 'reddit.json');
  var reddit_info = {};
  if (utils.fileExists(subreddit_config_file)) {
    reddit_info = utils.loadFromJsonFile(subreddit_config_file) || {};
  }

  if (!reddit_info[source_url]) {
    reddit_info[source_url] = source_config;
    console.log('Add subreddit: r/' + subreddit);
  } else {
    reddit_info[source_url] = Object.assign(reddit_info[source_url], source_config);
    console.log('Update subreddit: r/' + subreddit);
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

function _listSources(options) {
  var sources = [];
  for (var source_url in sources_store) {
    if (options.nsfw && !sources_store[source_url].nsfw) continue;
    sources.push({
      url: source_url, 
      name: source_url.replace('https://www.reddit.com/','').replace('http://reddit.com/',''),
      config: sources_store[source_url]
    });
  }

  console.log(chalk.grey(timeStamp()), chalk.magenta('list sources'), sources.length);

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
  })
}

function _addSources(sources_to_add, options) {
  var new_sources_count = 0;

  for (var i = 0; i < sources_to_add.length; i++) {
    var source_url = sources_to_add[i];
    if (source_url.slice(-1) == '/') {
      source_url = source_url.slice(0, source_url.length-1);
    }

    if (sources_store[source_url]) {
      console.log(chalk.grey(timeStamp()), chalk.magenta('already added'), source_url);
      
      var source_config = sources_store[source_url];
      showSourceConfig(source_config);

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

        console.log(chalk.grey(timeStamp()), chalk.green('update source'), source_url);
        
        showSourceConfig(source_config);
        saveSourceConfig(source_url, source_config, output_dir);
      }
    } else {
      new_sources_count++;
      console.log(chalk.grey(timeStamp()), chalk.green('new source'), source_url);
      
      var source_config = {
        added_at: new Date()
      };
      if (options.scrape_interval) source_config.scrape_interval = options.scrape_interval;
      if (options.download_posts) source_config.download_posts = true;
      if (options.nsfw) source_config.nsfw = true;

      sources_store[source_url] = source_config;

      showSourceConfig(source_config);
      saveSourceConfig(source_url, source_config, output_dir);
    }
  }

  console.log('---');
  console.log(chalk.grey(timeStamp()), chalk.bold('new sources'), new_sources_count);

  if (options.sources_file) {
    // utils.saveToJsonFile(sources_store, options.sources_file);
    saveJsonFileSafe(sources_store, options.sources_file);
  }
}

function _removeSources(sources_to_remove, options) {
  var removed_sources_count = 0;

  for (var i = 0; i < sources_to_remove.length; i++) {
    var source_url = sources_to_remove[i];

    if (!sources_store[source_url]) {
      console.log(chalk.grey(timeStamp()), chalk.magenta('already removed'), source_url);
    } else {
      removed_sources_count++;
      console.log(chalk.grey(timeStamp()), chalk.red('remove source'), source_url);
      delete sources_store[source_url];
    }
  }

  console.log('---');
  console.log(chalk.grey(timeStamp()), chalk.bold('removed sources'), removed_sources_count);

  if (options.sources_file) {
    // utils.saveToJsonFile(sources_store, options.sources_file);
    saveJsonFileSafe(sources_store, options.sources_file);
  }
}

function _updateSource(source_url, options) {
  var source = {
    url: source_url
  };

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
    
    var source_config = {
      added_at: new Date()
    };
    if (options.scrape_interval) source_config.scrape_interval = options.scrape_interval;
    if (options.download_posts) source_config.download_posts = true;
    if (options.nsfw) source_config.nsfw = true;

    sources_store[source_url] = source_config;
    saveSourceConfig(source_url, source_config, output_dir);
  }

  source.config = sources_store[source_url] || {};

  updateSource(source, output_dir, function() {
    // utils.saveToJsonFile(sources_store, options.sources_file);
    saveJsonFileSafe(sources_store, options.sources_file);
  });
}

function _updateSources(options) {
  var sources = [];

  for (var source_url in sources_store) {
    if (!sources_store[source_url].disable) {
      sources.push({
        url: source_url,
        config: sources_store[source_url]
      });
    }
  }

  console.log(chalk.grey(timeStamp()), chalk.magenta('update sources'), sources.length);

  for (var i = 0; i < sources.length; i++) {
    var source = {
      url: sources[i].url,
      config: sources[i].config
    };

    updateSource(sources[i], output_dir);
  }
}

function _watchSources(options) {
  var sources = [];

  for (var source_url in sources_store) {
    if (!sources_store[source_url].disable) {
      sources.push({
        url: source_url,
        config: sources_store[source_url]
      });
    }
  }

  console.log(chalk.grey(timeStamp()), chalk.magenta('watch sources'), sources.length);

  for (var i = 0; i < sources.length; i++) {
    var source = {
      url: sources[i].url,
      config: sources[i].config
    };

    var source_scrape_interval = source.config.scrape_interval || options.scrape_interval;
    source_scrape_interval = source_scrape_interval || default_scrape_interval 
    source_scrape_interval = source_scrape_interval * 1000; // to ms

    updateSourcePeriodically({
      url: sources[i].url,
      config: sources[i].config
    }, output_dir, source_scrape_interval);
  }
}

////


if (options.update || options.update_sources) {
  console.log(chalk.grey(timeStamp()), chalk.cyan('scrape from sources'));

  var output_dir = argv[1] || '.';

  options.sources_file = options.sources_file || path.join(output_dir, 'sources.json');
  console.log('Sources file:', options.sources_file);

  if (utils.fileExists(options.sources_file)) {
    sources_store = utils.loadFromJsonFile(options.sources_file);
  } 
  // else if (directoryExists(path.join(output_dir, 'r'))) {
  //   loadSourcesFromDir(output_dir);
  // }

  if (options.recursive) {
    loadSourcesFromDir(output_dir);
  }

  process.on('exit', function() {
    // utils.saveToJsonFile(sources_store, options.sources_file);
    saveJsonFileSafe(sources_store, options.sources_file);
  });

  _updateSources(options);
} 
else if (options.watch || options.watch_sources) {
  console.log(chalk.grey(timeStamp()), chalk.cyan('scrape from sources'));

  var output_dir = argv[1] || '.';

  options.sources_file = options.sources_file || path.join(output_dir, 'sources.json');
  console.log('Sources file:', options.sources_file);

  if (utils.fileExists(options.sources_file)) {
    sources_store = utils.loadFromJsonFile(options.sources_file);
  } 
  // else if (directoryExists(path.join(output_dir, 'r'))) {
  //   loadSourcesFromDir(output_dir);
  // }

  process.on('exit', function() {
    // utils.saveToJsonFile(sources_store, options.sources_file);
    saveJsonFileSafe(sources_store, options.sources_file);
  });

  _watchSources(options);
} 
else if (options.list || options.list_sources) {
  console.log(chalk.grey(timeStamp()), chalk.cyan('reddit sources'));

  var output_dir = argv[1] || '.';

  options.sources_file = options.sources_file || path.join(output_dir, 'sources.json');
  console.log('Sources file:', options.sources_file);

  if (utils.fileExists(options.sources_file)) {
    sources_store = utils.loadFromJsonFile(options.sources_file);
  }
  
  if (options.recursive) {
    loadSourcesFromDir(output_dir);
  }

  _listSources(options);

  process.exit();
}
else if ((options.add || options.add_source) && argv.length) {
  var sources_to_add = [];
  for (var i = 0; i < argv.length; i++) {
    if (argv[i].indexOf('http') == 0 && sources_to_add.indexOf(argv[i]) == -1) {
      sources_to_add.push(argv[i].replace('http://reddit.com/', 'https://www.reddit.com/'));
    } else if (argv[i].indexOf('r/') == 0 && sources_to_add.indexOf(argv[i]) == -1) {
      sources_to_add.push('https://www.reddit.com/' + argv[i]);
    }
  }
  sources_to_add = sources_to_add.map(function(source_url) {
    if (lastChar(source_url) == '/') {
      return removeLastChar(source_url);
    }
    return source_url;
  });

  var output_dir = argv[1] || '.';

  options.sources_file = options.sources_file || path.join(output_dir, 'sources.json');
  console.log('Sources file:', options.sources_file);

  if (utils.fileExists(options.sources_file)) {
    sources_store = utils.loadFromJsonFile(options.sources_file);
  } 
  // else if (directoryExists(path.join(output_dir, 'r'))) {
  //   loadSourcesFromDir(output_dir);
  // }

  _addSources(sources_to_add, options);

  process.exit();
} 
else if ((options.remove || options.remove_source) && argv.length) {
  var sources_to_remove = [];
  for (var i = 0; i < argv.length; i++) {
    if (argv[i].indexOf('http') == 0 && sources_to_remove.indexOf(argv[i]) == -1) {
      sources_to_remove.push(argv[i].replace('http://reddit.com/', 'https://www.reddit.com/'));
    } else if (argv[i].indexOf('r/') == 0 && sources_to_remove.indexOf(argv[i]) == -1) {
      sources_to_remove.push('https://www.reddit.com/' + argv[i]);
    }
  }
  sources_to_remove = sources_to_remove.map(function(source_url) {
    if (lastChar(source_url) == '/') {
      return removeLastChar(source_url);
    }
    return source_url;
  });

  var output_dir = argv[1] || '.';

  options.sources_file = options.sources_file || path.join(output_dir, 'sources.json');
  console.log('Sources file:', options.sources_file);

  if (utils.fileExists(options.sources_file)) {
    sources_store = utils.loadFromJsonFile(options.sources_file);
  }

  _removeSources(sources_to_remove, options);

  process.exit();
} 
else if ((options.import || options.import_sources) && argv.length) {

  var subredditLinkExtractor = require('./lib/subreddit-link-extractor.js')

  var updateSourcesFile = function(subreddit_links) {

    var output_dir = argv[1] || '.';

    options.sources_file = options.sources_file || path.join(output_dir, 'sources.json');
    console.log('Sources file:', options.sources_file);

    if (utils.fileExists(options.sources_file)) {
      sources_store = utils.loadFromJsonFile(options.sources_file);
    }

    _addSources(subreddit_links, options);

    process.exit();
  }

  if (options.from_html) {
    var html_file = path.resolve(argv[0]);

    console.log(chalk.grey(timeStamp()), chalk.cyan('import from HTML file'), html_file);
    var html = fs.readFileSync(html_file, 'utf8');
    subredditLinkExtractor.fromHtml(html, function(err, subreddit_links) {
      if (err) {
        console.log(err);
        process.exit(1);
      }
      console.log('Subreddit links:', subreddit_links.length);
      if (subreddit_links.length) updateSourcesFile(subreddit_links);
    });
  } else if (argv[0].indexOf('http') == 0) {
    var import_url = argv[0];

    console.log(chalk.grey(timeStamp()), chalk.cyan('import from URL'), import_url);
    subredditLinkExtractor.fromURL(import_url, function(err, subreddit_links) {
      if (err) {
        console.log(err);
        process.exit(1);
      }
      console.log('Subreddit links:', subreddit_links.length);
      if (subreddit_links.length) updateSourcesFile(subreddit_links);
    });
  } else {
    printUsage();
    process.exit();
  }
}
else if (argv.length && (argv[0].indexOf('http') == 0 || argv[0].indexOf('r/') == 0)) {
  var source_url = argv[0];

  if (argv[0].indexOf('r/') == 0) {
    source_url = 'https://www.reddit.com/' + argv[0];
  }
  if (lastChar(source_url) == '/') {
    source_url = removeLastChar(source_url);
  }

  console.log(chalk.grey(timeStamp()), chalk.cyan('scrape from URL'), source_url);

  var output_dir = argv[1] || '.';

  options.sources_file = options.sources_file || path.join(output_dir, 'sources.json');
  console.log('Sources file:', options.sources_file);

  if (utils.fileExists(options.sources_file)) {
    sources_store = utils.loadFromJsonFile(options.sources_file);
  }

  _updateSource(source_url, options);
} else {
  printUsage();
  process.exit();
}

