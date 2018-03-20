#!/usr/bin/env node

var path = require('path');
var urlutil = require('url');

var async = require('async');
var chalk = require('chalk');

var lockFile = require('lockfile');

var JsonStore = require('jul11co-jsonstore');
var utils = require('jul11co-utils');

var RedditScraper = require('./lib/reddit-scraper');

function printUsage() {
  console.log('Usage: ');
  console.log('       reddit-api-scrape <reddit-url> [output-dir]');
  console.log('       reddit-api-scrape --update [output-dir]');
  console.log('');
  console.log('OPTIONS:');
  console.log('       --verbose                   : verbose');
  console.log('');
  console.log('       --stop-if-no-new-posts, -S  : stop if current subreddit page has no new posts (default: not set)');
  console.log('');
}

if (process.argv.length < 3) {
  printUsage();
  process.exit();
}

var options = {};
var argv = [];
for (var i = 2; i < process.argv.length; i++) {
  if (process.argv[i] == '--stop-if-no-new-posts' || process.argv[i] == '-S') {
    options.stop_if_no_new_posts = true;
  }
  else if (process.argv[i].indexOf('--') == 0) {
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

var start_links = [];
for (var i = 0; i < argv.length; i++) {
  if (argv[i].indexOf('http') == 0) {
    var start_link = argv[i];
    if (start_link.indexOf('http:') == 0) {
      start_link = start_link.replace('http:', 'https:');
    }
    if (start_link.indexOf('//reddit.com/') != -1) {
      start_link = start_link.replace('//reddit.com/', '//www.reddit.com/');
    }
    console.log('Start link:', start_link);
    start_links.push(start_link);
  } else if (argv[i].indexOf('r/') == 0) {
    start_links.push('https://www.reddit.com/' + argv[i]);
  } else if (argv[i].indexOf('/r/') == 0) {
    start_links.push('https://www.reddit.com' + argv[i]);
  }
}

var output_dir = argv[1] || './';

if (options.update) {
  output_dir = argv[0]; 

  if (!utils.fileExists(path.join(output_dir, 'reddit.json'))) {
    console.log('Invalid output directory, reddit.json not found!');
    process.exit();
  }
} else {
  if (start_links.length == 1) {
    var subreddit = start_links[0].replace('https://www.reddit.com/r/','').split('/')[0].trim();
    output_dir = path.join(output_dir, 'r', subreddit);
    
    if (start_links[0].indexOf(subreddit + '/new') != -1) {
      console.log('New posts from ' + subreddit);
      options.new = true;
    } else if (start_links[0].indexOf(subreddit + '/hot') != -1) {
      console.log('Hot posts from ' + subreddit);
      options.hot = true;
    } else if (start_links[0].indexOf(subreddit + '/rising') != -1) {
      console.log('Rising posts from ' + subreddit);
      options.rising = true;
    } else if (start_links[0].indexOf(subreddit + '/controversial') != -1) {
      console.log('Controversial posts from ' + subreddit);
      options.controversial = true;
    } else if (start_links[0].indexOf(subreddit + '/top') != -1) {
      console.log('Top posts from ' + subreddit);
      options.top = true;
    } else if (start_links[0].indexOf(subreddit + '/gilded') != -1) {
      console.log('Gilded posts from ' + subreddit);
      options.gilded = true;
    } else if (start_links[0].indexOf(subreddit + '/promoted') != -1) {
      console.log('Promoted posts from ' + subreddit);
      options.promoted = true;
    }
  }
}

var lastChar = function(str) {
  return str.substring(str.length-1);
}

var removeLastChar = function(str) {
  return str.substring(0, str.length-1);
}

//

function processReport(data) {
  if (typeof process.send == 'function') {
    process.send(data);
  }
}

function scrapeLinks(links, output_dir, sources_store, options, callback) {

  // console.log('scrapeLinks');
  // console.log(links);

  var reddit_scraper = new RedditScraper({output_dir: output_dir});

  reddit_scraper.on('new-post', function(data) {
    processReport({
      new_post: true,
      post_info: data
    });
  });

  reddit_scraper.on('progress', function(data) {
    processReport({
      progress: true,
      scraped_posts_count: data.scraped_posts_count,
      new_posts_count: data.new_posts_count
    });
  });
  
  function printStats() {
    var stats = reddit_scraper.getStats();
    console.log('New posts count:', stats.new_posts_count);

    processReport({
      scraped_stats: true,
      scraped_posts_count: stats.scraped_posts_count,
      new_posts_count: stats.new_posts_count
    });
  }

  function gracefulShutdown() {
    console.log('');
    console.log('Exiting... Please wait');
    printStats();
    console.log('Done.');
    process.exit();
  }

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT' , gracefulShutdown);

  async.eachSeries(links, function(link, cb) {
    console.log(link);
    if (link.indexOf('https://www.reddit.com/r/') == 0) {
      var subreddit = link.replace('https://www.reddit.com/r/','').split('/')[0].trim();

      // console.log('processSubreddit:', subreddit);

      reddit_scraper.processSubreddit(subreddit, options, function(err) {
        if (!err) {
          sources_store.update(link, {last_update: new Date()}, true);
        }
        cb(err);
      });
    } else {
      cb();
    }
  }, function(err) {
    printStats();
    callback(err);
  });
}

//

if (options.update) {

  utils.ensureDirectoryExists(output_dir);

  lockFile.lock(path.join(output_dir, 'reddit.lock'), {}, function (err) {
    if (err) {
      console.log(err);
      process.exit(1);
    }

    var sources_store = new JsonStore({ file: path.join(output_dir, 'reddit.json') });
    for (var source_link in sources_store.toMap()) {
      if (start_links.indexOf(source_link) == -1) {
        start_links.push(source_link);
      }
    }

    scrapeLinks(start_links, output_dir, sources_store, options, function(err) {
      var scrape_err = err;

      lockFile.unlock(path.join(output_dir, 'reddit.lock'), function (err) {
        if (err) {
          console.log(err);
        }

        if (scrape_err) {
          console.log(scrape_err);
          process.exit(1);
        } else {
          console.log('Done.');
          process.exit(0);
        }
      });
    });
  });
} else if (start_links.length) {

  utils.ensureDirectoryExists(output_dir);

  lockFile.lock(path.join(output_dir, 'reddit.lock'), {}, function (err) {
    if (err) {
      console.log(err);
      process.exit(1);
    }

    var sources_store = new JsonStore({ file: path.join(output_dir, 'reddit.json') });
    start_links = start_links.map(function(start_link) {
      if (lastChar(start_link) == '/') {
        start_link = removeLastChar(start_link);
      }
      if (!sources_store.get(start_link)) {
        sources_store.set(start_link, {added_at: new Date()});
      }
      return start_link;
    });

    scrapeLinks(start_links, output_dir, sources_store, options, function(err) {
      if (err) {
        console.log(err);
      }

      lockFile.unlock(path.join(output_dir, 'reddit.lock'), function (err) {
        if (err) {
          console.log(err);
        }
        if (err) {
          console.log(err);
          process.exit(1);
        } else {
          console.log('Done.');
          process.exit(0);
        }
      });
    });
  });
} else {
  printUsage();
  process.exit(0);
}
