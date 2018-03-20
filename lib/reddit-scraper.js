// lib/reddit-scraper.js

var path = require('path');
var urlutil = require('url');
var util = require('util');
var EventEmitter = require('events').EventEmitter;

var async = require('async');
var chalk = require('chalk');
var moment = require('moment');

var nraw = require('nraw');
var NeDB = require('nedb');
var lockFile = require('lockfile');

var JsonStore = require('jul11co-jsonstore');

var utils = require('jul11co-utils');

var Reddit = new nraw("Archivebot");

var post_fields = [ // kind: 't3'
  "id", "name", "title", "url",
  "author", "domain",
  "permalink",
  "created", "created_utc",
  "subreddit", "subreddit_id", "subreddit_type",
  "over_18",
  // "preview",
  "thumbnail", "thumbnail_width", "thumbnail_height",
  "selftext", "selftext_html",
  "post_hint",
  "stickied", "locked", "archived",
  "spoiler",
  "is_video", "is_self",
  "num_comments", "score"
];

var post_return_fields = post_fields.concat([
  'num_comments', 'num_reports', 
  'score', 'ups', 'downs', 'upvote_ratio', 'likes',
  'edited', 'locked', 'stickied', 
  'quarantine', 'distinguished',
  'preview', 'media', 'media_embed'
]);

var comment_fields = [ // kind: 't1'
  "id", "link_id", "parent_id", "name",
  "author",
  "permalink",
  "created", "created_utc",
  "body", "body_html",
  "depth",
  "edited", "archived", "stickied", "collapsed", "edited", "gilded",
  "score", "ups", "downs", "replies", "likes"
];

var RedditScraper = function(opts) {
  EventEmitter.call(this);

  opts = opts || {};

  var posts_cache = null;
  var posts_store = null;

  var new_posts_count = 0;
  var scraped_posts_count = 0;

  var is_scraping = false;
  var destroy_requested = false;

  var subreddit_processing_count = 0;

  var self = this;

  self.destroy = function() {
    if (is_scraping) {
      destroy_requested = true;
    } else {
      if (posts_cache) posts_cache.exit();
      posts_store = null;
    }
  }

  self.busy = function() {
    return is_scraping;
  }

  var initPostsCache = function() {
    if (opts.output_dir) {
      utils.ensureDirectoryExists(opts.output_dir);
    }
    posts_cache = opts.posts_cache || new JsonStore({ file: path.join(opts.output_dir||'.', 'posts.json') });
  }

  var initPostsStore = function() {
    if (opts.output_dir) {
      utils.ensureDirectoryExists(opts.output_dir);
    }
    posts_store = opts.posts_store || new NeDB({
      filename: path.join(opts.output_dir||'.', 'posts.db'),
      autoload: true
    });
  }

  function savePostInfo(post_info, callback) {
    if (!posts_cache.get(post_info.id)) {
      new_posts_count++;
      console.log(chalk.green('New post:'), chalk.bold(post_info.id), 
        chalk.grey(moment(new Date(post_info.created_utc*1000)).fromNow()), 
        post_info.post_hint||'',
        utils.trimLeft(post_info.title)
      );
      posts_cache.set(post_info.id, {
        url: post_info.url,
        title: post_info.title,
        type: post_info.post_hint,
        added_at: new Date(),
        last_update: new Date()
      });
    } else {
      posts_cache.update(post_info.id, {
        url: post_info.url,
        title: post_info.title,
        type: post_info.post_hint,
        last_update: new Date()
      });
    }

    var post_item = {};
    for (var i = 0; i < post_fields.length; i++) {
      if (typeof post_info[post_fields[i]] != 'undefined') {
        post_item[post_fields[i]] = post_info[post_fields[i]];
      }
    }
    if (!post_item.id) post_item.id = post_info.id;

    posts_store.findOne({id: post_item.id}, function(err, post) {
      if (err) return callback(err);

      if (!post) {
        posts_store.insert(post_item, function(err) {
          if (err) return callback(err);
          self.emit('new-post', post_info);
          callback(null, post);
        });
      } else {
        posts_store.update({id: post_item.id}, post_item, function(err) {
          if (err) return callback(err);
          callback(null, post);
        });
      }
    });
  }

  function savePosts(posts, callback) {
    async.eachSeries(posts, function(post, cb) {
      post.id = post.id || post.url;
      savePostInfo(post, cb);
    }, callback);
  }

  function processPagination(pagination, options, callback) {
    if (typeof options == 'function') {
      callback = options;
      options = {};
    }
    callback();
  }

  function processPostInfo(post, options, callback) {
    if (typeof options == 'function') {
      callback = options;
      options = {};
    }
    callback(); 
  }

  function processPageInfo(page_info, options, callback) {
    if (typeof options == 'function') {
      callback = options;
      options = {};
    }
    var asyncTasks = [];
    if (page_info.post) {
      asyncTasks.push(function(cb) {
        console.log(chalk.green('Post info'));
        console.log('Title:', page_info.post.title);
        var post = page_info.post;
        post.id = post.id || post.url;
        savePostInfo(post, function(err) {
          if (err) return cb(err);
          processPostInfo(post, options, cb);
        });
      });
    }
    if (page_info.posts) {
      asyncTasks.push(function(cb) {
        console.log(chalk.bold('' + page_info.posts.length + ' posts'));
        savePosts(page_info.posts, function(err) {
          if (err) return cb(err);
          cb();
        });
      });
    }
    if (page_info.pagination) {
      asyncTasks.push(function(cb) {
        console.log(chalk.green('Pagination'));
        console.log(page_info.pagination);
        processPagination(page_info.pagination, options, function(err) {
          if (err) return cb(err);
          cb();
        });
      });
    }
    if (asyncTasks.length == 0) return callback();
    async.series(asyncTasks, function(err){
      callback(err);
    });
  }

  function processSubredditData(subreddit, data, options, callback) {

    // console.log(data);
    var asyncTasks = [];

    if (data.data && data.data.children) {
      asyncTasks.push(function(cb) {
        var posts = [];
        data.data.children.forEach(function(object) {
          // console.log(object);
          if (object.data) {
            // console.log('Title:', object.data.title);
            // console.log('URL:', object.data.url);
            // console.log('');
            posts.push(object.data);
          }
        });

        if (posts.length > 0) {
          console.log(chalk.bold('Scraped posts:'), posts.length);
          scraped_posts_count += posts.length;
          processPageInfo({ 
            url: subreddit,
            posts: posts
          }, options, cb);
        } else {
          console.log(chalk.green('No posts'));
          cb();
        }
      });
    }

    if (asyncTasks.length == 0) return callback();

    var prev_new_posts_count = new_posts_count;

    async.series(asyncTasks, function(err){
      if (err) {
        console.error('Process subreddit data failed:', subreddit, 
          ((data.data && data.data.after) ? chalk.yellow('after: ' + data.data.after) : '')
        );
      } else {
        // console.log('Process subreddit data finished:', subreddit, 
        //   ((data.data && data.data.after) ? chalk.yellow('after: ' + data.data.after) : '')
        // );
      }

      self.emit('progress', {
        scraped_posts_count: scraped_posts_count,
        new_posts_count: new_posts_count
      });

      if (options.stop_if_no_new_posts && prev_new_posts_count == new_posts_count) {
        console.log(chalk.bold('No new posts'));

        setTimeout(function() {
          callback(err);
        }, 1000);
      } else if (data.data && data.data.after) {
        console.log(chalk.bold('New posts:'), new_posts_count-prev_new_posts_count);

        // Next subreddit page of posts
        options.after = data.data.after;

        setTimeout(function() {
          processSubreddit(subreddit, options, function(err) {
            callback(err);
          });
        }, 1000);
      } else {
        setTimeout(function() {
          callback(err);
        }, 1000);
      }
    });
  }

  function processSubreddit(subreddit, options, callback) {
    if (typeof options == 'function') {
      callback = options;
      options = {};
    }

    if (!is_scraping && destroy_requested) {
      return callback(new Error('Scraper was destroyed'));
    }
    
    if (!is_scraping) is_scraping = true;
    subreddit_processing_count++;

    var reddit_query = Reddit.subreddit(subreddit);

    if (options.top) {
      reddit_query = reddit_query.top();
    } else if (options.hot) {
      reddit_query = reddit_query.hot();
    } else if (options.new) {
      reddit_query = reddit_query.new();
    } else if (options.rising) {
      reddit_query = reddit_query.rising();
    } else if (options.controversial) {
      reddit_query = reddit_query.controversial();
    } else if (options.promoted) {
      reddit_query = reddit_query.promoted();
    }
    if (options.after) {
      console.log(chalk.magenta('Subreddit:'), subreddit, chalk.yellow('after: ' + options.after));
      reddit_query = reddit_query.after(options.after);
    } else {
      console.log(chalk.magenta('Subreddit:'), subreddit);
    }

    if (!reddit_query) return callback();
    
    try {
      reddit_query.exec(function(data) {
        processSubredditData(subreddit, data, options, function(err) {
          subreddit_processing_count--;
          if (subreddit_processing_count == 0) {
            is_scraping = false;
            if (destroy_requested) self.destroy();
          }
          return callback(err);
        });
      });
    } catch(e) {
      return callback(e);
    }    
  }

  var extractPostInfo = function(post_data, return_fields) {
    var post_info = {};
    return_fields = return_fields || post_return_fields;
    for (var i = 0; i < return_fields.length; i++) {
      if (typeof post_data[return_fields[i]] != 'undefined') {
        post_info[return_fields[i]] = post_data[return_fields[i]];
      }
    }
    return post_info;
  }

  var extractCommentInfo = function(comment_data, return_fields) {
    var comment_info = {};
    return_fields = return_fields || comment_fields;
    for (var i = 0; i < return_fields.length; i++) {
      if (return_fields[i] == 'replies') {
        comment_info['replies'] = extractCommentReplies(comment_data['replies']);
      } else {
        comment_info[return_fields[i]] = comment_data[return_fields[i]];
      }
    }
    return comment_info;
  }

  var extractCommentReplies = function(replies) {
    if (!replies || replies == '') return {};
    var result = {};
    if (replies.kind == 'Listing' && replies.data && replies.data.children && replies.data.children.length) {
      if (replies.data.after) result.after = replies.data.after;
      if (replies.data.before) result.before = replies.data.before;
      result.children = [];
      replies.data.children.forEach(function(comment_item) {
        if (comment_item.kind != 't1') return;
        var comment_info = extractCommentInfo(comment_item.data);
        result.children.push(comment_info);
      });
    }
    return result;
  }

  ///

  self.processSubreddit = function(subreddit, options, callback) {
    subreddit_processing_count = 0;
    scraped_posts_count = 0;
    new_posts_count = 0;
    if (!posts_cache) initPostsCache();
    if (!posts_store) initPostsStore();
    return processSubreddit(subreddit, options, callback);
  };

  self.getStats = function() {
    return {
      scraped_posts_count: scraped_posts_count,
      new_posts_count: new_posts_count
    };
  }

  self.getSubredditPosts = function(subreddit, options, callback) {
    if (typeof options == 'function') {
      callback = options;
      options = {};
    }

    var reddit_query = Reddit.subreddit(subreddit);

    if (options.top) {
      reddit_query = reddit_query.top();
    } else if (options.hot) {
      reddit_query = reddit_query.hot();
    } else if (options.new) {
      reddit_query = reddit_query.new();
    } else if (options.rising) {
      reddit_query = reddit_query.rising();
    } else if (options.controversial) {
      reddit_query = reddit_query.controversial();
    } else if (options.promoted) {
      reddit_query = reddit_query.promoted();
    }
    if (options.after) {
      reddit_query = reddit_query.after(options.after);
    }
    if (options.limit) {
      reddit_query = reddit_query.limit(options.limit);
    }
    try {
      reddit_query.exec(function(data) {
        var posts = [];
        console.log(data);
        if (data && data.data && data.data.children  && data.data.children.length) {
          // console.log(data[1].data.children);
          data.data.children.forEach(function(post_item) {
            if (post_item.kind != 't3') return;
            posts.push(extractPostInfo(post_item.data));
          });
        }
        return callback(null, {
          posts: posts,
          after: data.data.after,
          before: data.data.before
        });
      }, function(err) {
        return callback(err);
      });
    } catch(e) {
      return callback(e);
    } 
  };

  var util = require('util');

  self.getPost = function(subreddit, post_id, options, callback) {
    if (typeof options == 'function') {
      callback = options;
      options = {};
    }
    var reddit_query = Reddit.subreddit(subreddit).post(post_id);

    try {
      reddit_query.exec(function(data){
        var post_info = {};
        // console.log(data);
        if (Array.isArray(data) && data.length > 1) {
          if (data[0].data && data[0].data.children 
            && data[0].data.children.length && data[0].data.children[0].kind == 't3') {
            var post_data = data[0].data.children[0].data;
            // console.log(post_data);
            post_info = extractPostInfo(post_data);
          }
          if (data[1] && data[1].data && data[1].data.children  && data[1].data.children.length) {
            post_info.comments = [];
            // console.log(data[1].data.children);
            var comment_return_fields = comment_fields;
            data[1].data.children.forEach(function(comment_item) {
              if (comment_item.kind != 't1') return;
              post_info.comments.push(extractCommentInfo(comment_item.data));
            });
          }
        }
        return callback(null, post_info);
      }, function(err) {
        return callback(err);
      });
    } catch(e) {
      return callback(e);
    } 
  }

  // self.getRelatedPosts = function(subreddit, post_id, options, callback) {
  //   if (typeof options == 'function') {
  //     callback = options;
  //     options = {};
  //   }
  //   var reddit_query = Reddit.subreddit(subreddit).post(post_id).related();
  //   reddit_query.exec(function(data){
  //     return callback(null, data);
  //   }, function(err) {
  //     return callback(err);
  //   });
  // }

  self.getPostComments = function(subreddit, post_id, options, callback) {
    if (typeof options == 'function') {
      callback = options;
      options = {};
    }
    var reddit_query = Reddit.subreddit(subreddit).post(post_id).comments();
    if (options.top) {
      reddit_query = reddit_query.top();
    }
    if (options.limit) {
      reddit_query = reddit_query.limit(options.limit);
    }
    try {
      reddit_query.exec(function(data){
        var comments = [];
        // console.log(data);
        if (Array.isArray(data) && data.length) {
          // data[0] is post info
          if (data[1] && data[1].data && data[1].data.children  && data[1].data.children.length) {
            // console.log(data[1].data.children);
            data[1].data.children.forEach(function(comment_item) {
              if (comment_item.kind != 't1') return;
              comments.push(extractCommentInfo(comment_item.data));
            });
          }
        }
        return callback(null, comments);
      }, function(err) {
        return callback(err);
      });
    } catch(e) {
      return callback(e);
    } 
  }

  self.getComment = function(subreddit, post_id, comment_id, options, callback) {
    if (typeof options == 'function') {
      callback = options;
      options = {};
    }
    var reddit_query = Reddit.subreddit(subreddit).post(post_id).comment(comment_id);
    try {
      reddit_query.exec(function(data){
        var comment_info = {};
        // console.log(data);
        if (Array.isArray(data) && data.length) {
          // data[0] is post info
          if (data[1] && data[1].data && data[1].data.children  && data[1].data.children.length) {
            // console.log(data[1].data.children);
            var comment_return_fields = comment_fields;
            if (data[1].data.children[0].kind == 't1') {
              comment_info = extractCommentInfo(data[1].data.children[0].data);
            }
          }
        }
        return callback(null, comment_info);
      }, function(err) {
        return callback(err);
      });
    } catch(e) {
      return callback(e);
    } 
  }

}

util.inherits(RedditScraper, EventEmitter);

module.exports = RedditScraper;

