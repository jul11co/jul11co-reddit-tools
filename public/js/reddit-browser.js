$(document).ready(function() {
  
  $('.list-group-item.sub').on('click', function(event) {
    event.preventDefault();
    $(this).next().toggleClass('active');
  });

  $('.sub-items .list-group-item.active').each(function() {
    $(this).parent().addClass('active');
    // $(this).parent().prev().toggleClass('active');
  });

  // Lazyload Images

  // $("img.lazyload").lazyload(); // jquery.lazyload

  // Correct datetime
  moment.updateLocale('en', {
    relativeTime : {
      future: "in %s",
      past  : "%s",
      s     : "now",
      ss    : "%ds",
      m     : "1min",
      mm    : "%dmins",
      h     : "1h",
      hh    : "%dh",
      d     : "1d",
      dd    : "%dd",
      M     : "1mth",
      MM    : "%dmths",
      y     : "1y",
      yy    : "%dy"
    }
  });
  $('.item-post td.date').each(function() {
    var created_utc = $(this).attr('data-created-utc');
    if (created_utc) {
      created_utc = parseInt(created_utc);
      $(this).text(moment(created_utc*1000).format('MMM DD, YYYY hh:mm A'));
    }
  });

  // Open external link correctly

  $('.open-external-link').on('click', function(event) {
    event.stopPropagation();
  });

  $('.open-in-new-tab').on('click', function(event) {
    event.stopPropagation();
    event.preventDefault();

    var post_url = $(this).attr('data-post-url');
    if (post_url && post_url != '') {
      window.location.href = post_url;
    }
  });

  ////

  $('#toggle-add-subreddit-form').on('click', function(event) {
    event.preventDefault();
    $('#add-subreddit-form').toggleClass('hidden');
  });

  $('#add-subreddit-form').on('submit', function(event) {
    event.preventDefault();
    var subreddit_name = $('#add-subreddit-name').val().trim();
    if (subreddit_name && subreddit_name != '') {
      var $button = $('#add-subreddit-form-submit');
      var button_text = $button.text();
      var resetButtonText = function(){ $button.text(button_text); };

      $button.text('Adding...');
      $.post('/add?subreddit=' + encodeURIComponent(subreddit_name), function(data) {
        console.log(data);
        if (data && data.existed) {
          $button.text('Existed!');
          setTimeout(resetButtonText, 2000);
        } else if (data && data.queued) {
          $button.text('Queued!');
          setTimeout(resetButtonText, 2000);
        } else if (data && data.error) {
          $button.text('Error!');
          setTimeout(resetButtonText, 2000);
        } else {
          resetButtonText();
        }
      }).fail(function(data) {
        console.log(data);
        if (data.responseJSON && data.responseJSON.error) {
          $button.text('Error!');
          setTimeout(resetButtonText, 2000);
        } else {
          $button.text('Error!');
          setTimeout(resetButtonText, 2000);
        }
      });
    }
  });

  ////

  $('#toggle-search-post-form').on('click', function(event) {
    event.preventDefault();
    $('#search-post-form').toggleClass('hidden');
  });

  $('.toggle-this-subreddit-star').on('click', function(event) {
    event.preventDefault();
    var subreddit_name = $(this).attr('data-subreddit');
    if (subreddit_name && subreddit_name != '') {
      var $button = $(this);
      var is_starred = $button.attr('data-starred') == 'true';
      var button_text = $button.text();
      var resetButtonText = function(){ $button.text(button_text); };

      $button.html('<span><i class="fa fa-spinner fa-pulse fa-fw"></i>');

      if (!is_starred) {
        $.post('/star?subreddit=' + encodeURIComponent(subreddit_name), function(data) {
          console.log(data);
          if (data && data.starred) {
            $button.html('<span><i class="fa fa-star fa-fw"></i>');
            $button.attr('data-starred', true);
            window.location.href = '/';
          } else {
            $button.html('<span><i class="fa fa-star-o fa-fw"></i>');
          }
        }).fail(function(data) {
          console.log(data);
          if (data.responseJSON && data.responseJSON.error) {
            $button.html('<span><i class="fa fa-star-o fa-fw"></i>');
          } else {
            $button.html('<span><i class="fa fa-star-o fa-fw"></i>');
          }
        });
      } else {
        $.post('/unstar?subreddit=' + encodeURIComponent(subreddit_name), function(data) {
          console.log(data);
          if (data && data.unstarred) {
            $button.html('<span><i class="fa fa-star-o fa-fw"></i>');
            $button.attr('data-starred', false);
            window.location.href = '/';
          } else {
            $button.html('<span><i class="fa fa-star fa-fw"></i>');
          }
        }).fail(function(data) {
          console.log(data);
          if (data.responseJSON && data.responseJSON.error) {
            $button.html('<span><i class="fa fa-star fa-fw"></i>');
          } else {
            $button.html('<span><i class="fa fa-star fa-fw"></i>');
          }
        });
      }
    }
  });

  /* Realtime Communication */

  // var socket = io();
  // socket.on('scraping', function(data){
  //   $('#subreddit-status').text('Scraping...');
  //   $('#subreddit-status').removeClass('hidden');
  // });
  // socket.on('scraping-done', function(data){
  //   $('#subreddit-status').text('Scraping... Done');
  //   // $('#subreddit-status').addClass('hidden');
  //   if (!is_previewing && data && data.new_posts_count) {
  //     window.location.href = '/';
  //   }
  // });
  // socket.on('scraping-progress', function(data){
  //   if (data && data.new_posts_count) {
  //     $('#subreddit-status').text('Scraping... ' + data.new_posts_count);
  //   }
  // });

  /* Post Preview */

  var current_index = -1;
  var is_previewing = false;

  var markdownParser = SnuOwnd.getParser();

  var previewable_posts_count = 0;
  var previewable_posts_index_map = {};

  var post_preview_image_size = 'fit'; // 'fit', 'fit-width', 'fit-height', 'max'

  var image_hosts = [
    'i.redd.it',
    'media.tumblr.com',
    'staticflickr.com',
    'pbs.twimg.com',
    'img.ahawallpaper.com'
  ];

  var isSupportedImageURL = function(image_url) {
    if (!image_url) return false;
    return image_hosts.some(function(image_host) {
      return image_url.indexOf(image_host) != -1;
    });
  }

  var isLinkPost = function($item) {
    return $item.hasClass('item-post-link') || $item.hasClass('item-post-rich-video');
  }
  var isSelfPost = function($item) {
    return $item.attr('data-post-self') == 'true';
  }
  var isImagePost = function($item) {
    return $item.hasClass('item-post-image') || ($item.hasClass('item-post-') && 
      isSupportedImageURL($item.attr('data-post-link'))) || ($item.hasClass('item-post-link') && 
      isSupportedImageURL($item.attr('data-post-link')));
  }
  var isVideoPost = function($item) {
    return $item.hasClass('item-post-video');
  }
  var isGfycatPost = function($item) {
    return ($item.hasClass('item-post-') || $item.hasClass('item-post-link') || $item.hasClass('item-post-rich-video')) 
      && $item.attr('data-post-link').indexOf('gfycat.com') != -1;
  }
  var isImgurPost = function($item) {
    return ($item.hasClass('item-post-') || $item.hasClass('item-post-link') || $item.hasClass('item-post-rich-video')) 
      && $item.attr('data-post-link').indexOf('imgur.com') != -1;
  }
  var isImgurGifvPost = function($item) {
    var post_link = $item.attr('data-post-link');
    return ($item.hasClass('item-post-') || $item.hasClass('item-post-link') || $item.hasClass('item-post-rich-video')) 
      && (post_link && post_link.indexOf('i.imgur.com') != -1 && post_link.indexOf('.gifv') != -1);
  }

  function escapeRegExp(string) {
    return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
  }

  function replaceAll(string, find, replace) {
    return string.replace(new RegExp(escapeRegExp(find), 'g'), replace);
  }

  function unescapeHtml(safe) {
    return safe.replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'");
  }

  var getNextPreviewItem = function() {

    var next_index = current_index+1;
    // console.log('Index:', current_index);

    if (next_index >= $('table#items tbody tr').length) {
      return null;
    }

    current_index = next_index;

    var $item = $('table#items tbody tr').eq(current_index);
    if ($item) {
      if (isImagePost($item) || isVideoPost($item) || isSelfPost($item) || isLinkPost($item) 
        || isGfycatPost($item) || isImgurPost($item)) {
        return $item;
      } else {
        return getNextPreviewItem();
      }
    } else {
      return getNextPreviewItem();
    }
  }

  var getPrevPreviewItem = function() {

    if (current_index == 0) {
      return null;
    }

    current_index = current_index-1;
    // console.log('Index:', current_index);

    var $item = $('table#items tbody tr').eq(current_index);
    if ($item) {
      if (isImagePost($item) || isVideoPost($item) || isSelfPost($item) || isLinkPost($item) 
        || isGfycatPost($item) || isImgurPost($item)) {
        return $item;
      } else {
        return getPrevPreviewItem();
      }
    } else {
      return getPrevPreviewItem();
    }
  }

  var commentToHtml = function(comment, post_author) {
    var comment_html = '';
    comment_html += '<span class="post-preview-comment" data-comment-id="' + comment.id + '"'
    if (comment.depth) comment_html += ' style="margin-left:' + (5+5*comment.depth) + 'px;"';
    comment_html += '>';
    if (comment.author==post_author) {
      comment_html += '<b>' + comment.author + '</b> <span class="label label-primary">OP</span>';
    } else {
      comment_html += '<b style="font-size: 12px;">' + comment.author + '</b>';
    }
    // comment_html += ':';
    comment_html += '<span class="post-preview-comment-body">' + markdownParser.render(unescapeHtml(comment.body)) + '</span>';
    comment_html += '<p style="font-size: 12px;margin-bottom: 0;">';
    comment_html += '<span><a href="https://www.reddit.com' + comment.permalink + 
      '" target="_blank" style="color: white;"><i class="fa fa-reddit fa-fw"></i></a></span> ';
    if (comment.score!=1) comment_html += '<span>' + comment.score + ' <b>points</b></span> ';
    else comment_html += '<span>1 <b>point</b></span> ';
    // comment_html += '<span><i class="fa fa-arrow-up fa-fw"></i>' + comment.ups + '</span> ';
    // comment_html += '<span><i class="fa fa-arrow-down fa-fw"></i>' + comment.downs + '</span> ';
    comment_html += '- <span class="date">' + moment(comment.created_utc*1000).format('MMM DD, YYYY hh:mm A') + '</span> ';
    comment_html += ' &middot; ' + moment(comment.created_utc*1000).fromNow();
    comment_html += '</p>';
    comment_html += '</span>';
    return comment_html;
  }

  var renderComment = function(comment, post_author) {
    $('#post-preview-comments').append(commentToHtml(comment, post_author));
    // add replies
    if (comment.replies && comment.replies.children && comment.replies.children.length) {
      comment.replies.children.forEach(function(reply) {
        renderComment(reply, post_author);
      });
    }
  }

  var loadPostComments = function(post_id, post_info) {
    $.getJSON('/post_comments?post_id=' + post_id, function(data) {
      console.log(data);

      $('#post-preview-comments').html('');
      if (data.num_comments) {
        $('#post-preview-num-comments').text(data.num_comments);
        // $('#post-preview-comments-toggle').removeClass('hidden');
      } else {
        $('#post-preview-num-comments').text('0');
      }

      var op_html = '<span class="post-preview-comment" style="margin-left: 0;">';
      op_html += '<b>' + post_info.author + '</b> <span class="label label-primary">OP</span>'+
        ' on <a href="https://www.reddit.com/r/' + post_info.subreddit + 
        '" target="_blank"><i>/r/' + post_info.subreddit + '</i></a>.';
      op_html += '<span class="post-preview-comment-body">' + markdownParser.render(unescapeHtml(post_info.title||'')) + '</span>';
      op_html += '<p style="font-size: 12px;margin-bottom: 0;">';
      op_html += '<span><a href="' + post_info.permalink + 
        '" target="_blank" style="color: white;"><i class="fa fa-reddit fa-fw"></a></i></span> ';
      var posted_moment = moment(post_info.created_utc*1000);
      op_html += '<span class="date">' + posted_moment.format('MMM DD, YYYY hh:mm A') + 
        '</span> &middot; ' + posted_moment.fromNow() + '';
      op_html += '</p>';
      op_html += '</span>';
      $('#post-preview-comments').append(op_html);

      if (data.comments && data.comments.length) {
        data.comments.forEach(function(comment) {
          // $('#post-preview-comments').append(renderComment(comment));
          renderComment(comment, post_info.author);
        });
        $('#post-preview-comments a').each(function() {
          var link_href = $(this).attr('href');
          // console.log(link_href);
          if (link_href && link_href != '' && link_href != '#') {
            if (link_href.indexOf('/') == 0) {
              link_href = 'https://www.reddit.com' + link_href;
            }
            else if (link_href.indexOf('r/' || link_href.indexOf('u/') == 0) == 0) {
              link_href = 'https://www.reddit.com/' + link_href;
            }
            $(this).attr('href', link_href);
            $(this).attr('target', '_blank');
          }
        });
      }
    }).fail(function(data) {
      console.log(data);
    });
  }

  var previewLinkPost = function($item, post_id, post_link, post_info) {
    $('#post-preview-file-info').text('External Link');

    // $('#post-preview-title-container').addClass('hidden');
    
    // $('#post-preview-comments-container').addClass('inline');
    // $('#post-preview-comments-container').removeClass('fixed');

    // $('#post-preview-comments-inline').removeClass('hidden');

    $('#post-preview-content').html(
      '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>'
    );

    $.getJSON('/post?post_id=' + post_id, function(data) {
      console.log(data);
      if (data && data.error) {
        console.log(data.error);
        $('#post-preview-content').html(
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>' + 
          '<span style="display: inline-block;color: white;">' + data.error + '</span>'
          );
      } else if (data) {
        var preview_html = '';
        preview_html += '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>';
        preview_html += '<div class="selftext" style="display: inline-block;vertical-align: middle;">'
        preview_html += '<span style="font-size:12px;">/r/' + data.subreddit;
        preview_html += ' &middot; ' + moment(data.created_utc*1000).fromNow();
        preview_html += '</span>';
        preview_html += '<p><b>' + data.author + '</b>: <i>' + data.title + '</i></p>';
        if (data.thumbnail && data.thumbnail != 'default') {
          preview_html += '<p><img src="' + data.thumbnail + '" height="' + data.thumbnail_height + '"/></p>';
        }
        preview_html += '<p>External link:<br/><a href="' + post_link + '" target="_blank">' + post_link + '</p>';
        preview_html += '</div>';
        $('#post-preview-content').html(preview_html);

        $('#post-preview-content a').on('click', function(event) {
          event.stopPropagation();
        });
        $('#post-preview-content a').each(function() {
          var link_href = $(this).attr('href');
          // console.log(link_href);
          if (link_href && link_href != '' && link_href != '#') {
            if (link_href.indexOf('/') == 0) {
              link_href = 'https://www.reddit.com' + link_href;
            }
            else if (link_href.indexOf('r/' || link_href.indexOf('u/') == 0) == 0) {
              link_href = 'https://www.reddit.com/' + link_href;
            }
            $(this).attr('href', link_href);
            $(this).attr('target', '_blank');
          }
        });
      } else {
        $('#post-preview-content').html(
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>'
          );
      }
    }).fail(function(data) {
      console.log(data);
      if (data.responseJSON && data.responseJSON.error) {
        $('#post-preview-content').html(
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>' +
          '<span style="display: inline-block;color: white;vertical-align: middle;">' + data.responseJSON.error + '</span>'
          );
      } else {
        $('#post-preview-content').html(
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>'
          );
      }
    });
    $("#previewModal").modal('show');

    loadPostComments(post_id, post_info);
  }

  var previewSelfPost = function($item, post_id, post_link, post_info) {
    $('#post-preview-file-info').text('Self');

    // $('#post-preview-title-container').addClass('hidden');

    // $('#post-preview-comments-container').addClass('inline');
    // $('#post-preview-comments-container').removeClass('fixed');

    // $('#post-preview-comments-inline').removeClass('hidden');

    $('#post-preview-content').html(
      '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>'
    );

    $.getJSON('/post?post_id=' + post_id, function(data) {
      console.log(data);
      if (data && data.error) {
        console.log(data.error);
        $('#post-preview-content').html(
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>' + 
          '<span style="display: inline-block;color: white;vertical-align: middle;">' + data.error + '</span>'
          );
      } else if (data) {
        var preview_html = '';
        preview_html += '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>';
        var selftext = markdownParser.render(unescapeHtml(data.selftext||''));
        preview_html += '<div class="selftext" style="display: inline-block;vertical-align: middle;">'
        preview_html += '<span style="font-size:12px;">/r/' + data.subreddit;
        preview_html += ' &middot; ' + moment(data.created_utc*1000).fromNow();
        preview_html += '</span>';
        preview_html += '<p><b>' + data.author + '</b>: <i>' + data.title + '</i></p>';
        preview_html += '<p>' + selftext + '</p>';
        preview_html += '</div>';
        $('#post-preview-content').html(preview_html);

        $('#post-preview-content a').on('click', function(event) {
          event.stopPropagation();
        });
        $('#post-preview-content a').each(function() {
          var link_href = $(this).attr('href');
          // console.log(link_href);
          if (link_href && link_href != '' && link_href != '#') {
            if (link_href.indexOf('/') == 0) {
              link_href = 'https://www.reddit.com' + link_href;
            }
            else if (link_href.indexOf('r/' || link_href.indexOf('u/') == 0) == 0) {
              link_href = 'https://www.reddit.com/' + link_href;
            }
            $(this).attr('href', link_href);
            $(this).attr('target', '_blank');
          }
        });
      } else {
        $('#post-preview-content').html(
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>'
          );
      }
    }).fail(function(data) {
      console.log(data);
      if (data.responseJSON && data.responseJSON.error) {
        $('#post-preview-content').html(
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>' +
          '<span style="display: inline-block;color: white;vertical-align: middle;">' + data.responseJSON.error + '</span>'
          );
      } else {
        $('#post-preview-content').html(
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>'
          );
      }
    });
    $("#previewModal").modal('show');

    loadPostComments(post_id, post_info);
  }

  var previewImagePost = function($item, post_id, post_link, post_info) {
    $('#post-preview-file-info').text('Image');

    $('#post-preview-content').html(
      '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>' +
      '<img class="fadeIn animated lazyload ' + (post_preview_image_size||'fit') + '" ' +
      'src="data:image/gif;base64,R0lGODdhAQABAPAAAMPDwwAAACwAAAAAAQABAAACAkQBADs="' +
      ' data-src="' + post_link + '">'
    );
    $("#previewModal").modal('show');
    
    if (post_preview_image_size == 'fit-width' || post_preview_image_size == 'max') {
      showZoom();
      applyZoom();
    }

    $("<img/>").on('load', function(){
      var file_info = $('#post-preview-file-info').text();
      file_info += ' - W:' + this.width + ' x H:' + this.height;
      $('#post-preview-file-info').text(file_info);
    }).attr("src", post_link);

    loadPostComments(post_id, post_info);
  }

  var previewVideoPost = function($item, post_id, post_link, post_info) {
    $('#post-preview-file-info').text('Video');

    var preview_html = 
      '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>' +
      '<video width="100%" height="95%" controls="controls" autoplay loop>';
    if (post_link.indexOf('.mp4') != -1) {
      preview_html += '<source src="' + post_link + '" type="video/mp4" />';
    } else if (post_link.indexOf('.webm') != -1) {
      preview_html += '<source src="' + post_link + '" type="video/webm" />';
    }
    preview_html += '</video>';

    $('#post-preview-content').html(preview_html);
    $("#previewModal").modal('show');

    loadPostComments(post_id, post_info);
  }

  var previewGfycatPost = function($item, post_id, post_link, post_info) {
    $('#post-preview-file-info').text('Gfycat');
    $('#post-preview-external-link-button').attr('href', post_link);

    $('#post-preview-content').html(
      '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>' +
      '<span style="display: inline-block;color: white;"><i class="fa fa-spinner fa-pulse fa-2x fa-fw"></i></span>'
      );
    $.getJSON('/gfycat?url=' + encodeURIComponent(post_link), function(data) {
      console.log(data);
      if (data && data.error) {
        console.log(data.error);
        $('#post-preview-content').html(
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>' + 
          '<span style="display: inline-block;color: white;vertical-align: middle;">' + data.error + '</span>'
          );
      } else if (data && data.gfycat) {
        var preview_html = 
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>';
        if (data.gfycat.mp4) { // mp4
          $('#post-preview-file-info').text('Gfycat - MP4');
          preview_html += '<video width="100%" height="95%" controls="controls" autoplay>';
          preview_html += '<source src="' + data.gfycat.mp4 + '" type="video/mp4" />';
          preview_html += '</video>';
        } else if (data.gfycat.webm) { // webm
          $('#post-preview-file-info').text('Gfycat - WebM');
          preview_html += '<video width="100%" height="95%" controls="controls" autoplay>';
          preview_html += '<source src="' + data.gfycat.webm + '" type="video/webm" />';
          preview_html += '</video>';
        } else if (data.gfycat.gif) { // gif
          $('#post-preview-file-info').text('Gfycat - GIF');
          preview_html += '<img class="fit" src="' + data.gfycat.gif + '">';
        }
        $('#post-preview-content').html(preview_html);
      } else {
        $('#post-preview-content').html(
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>'
          );
      }
    }).fail(function(data) {
      console.log(data);
      if (data.responseJSON && data.responseJSON.error) {
        $('#post-preview-content').html(
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>' + 
          '<span style="display: inline-block;color: white;vertical-align: middle;">' + data.responseJSON.error + '</span>'
          );
      } else {
        $('#post-preview-content').html(
          '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>'
          );
      }
    });

    $("#previewModal").modal('show');

    loadPostComments(post_id, post_info);
  }

  var previewImgurPost = function($item, post_id, post_link, post_info) {
    $('#post-preview-file-info').text('Imgur');

    if (post_link.indexOf('i.imgur.com') != -1 && post_link.indexOf('.gifv') != -1) {
      var imgur_url = post_link;
      imgur_url = imgur_url.replace('i.imgur.com', 'imgur.com');
      imgur_url = imgur_url.replace('.gifv', '.mp4');

      var preview_html = 
        '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>';
        $('#post-preview-file-info').text('Imgur - GIFV');
        preview_html += '<video width="100%" height="95%" controls="controls" autoplay>';
        preview_html += '<source src="' + imgur_url + '" type="video/mp4" />';
        preview_html += '</video>';

      $('#post-preview-content').html(preview_html);
    } else if (post_link.indexOf('i.imgur.com') != -1 && post_link.indexOf('.mp4') != -1) {
      var imgur_url = post_link;
      imgur_url = imgur_url.replace('i.imgur.com', 'imgur.com');

      $('#post-preview-file-info').text('Imgur - GIFV');

      var preview_html = '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>';
      preview_html += '<video width="100%" height="95%" controls="controls" autoplay>';
      preview_html += '<source src="' + imgur_url + '" type="video/mp4" />';
      preview_html += '</video>';

      $('#post-preview-content').html(preview_html);
    } else {
      $('#post-preview-content').html(
        '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>' +
        '<span style="display: inline-block;color: white;"><i class="fa fa-spinner fa-pulse fa-2x fa-fw"></i></span>'
        );
      
      $.getJSON('/imgur?url=' + encodeURIComponent(post_link), function(data) {
        console.log(data);
        if (data && data.error) {
          console.log(data.error);
          $('#post-preview-content').html(
            '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>' + 
            '<span style="display: inline-block;color: white;vertical-align: middle;">' + data.error + '</span>'
            );
        } else if (data && data.images && data.images.length) {
          $('#post-preview-file-info').text('Imgur (' + data.images.length 
            + ' image' + ((data.images.length>1)?'s)':')'));

          var preview_html = 
            '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>';
          preview_html += '<img class="fadeIn animated lazyload ' + (post_preview_image_size||'fit') + 
            '" src="data:image/gif;base64,R0lGODdhAQABAPAAAMPDwwAAACwAAAAAAQABAAACAkQBADs=" data-src="' + 
            data.images[0].src + '" alt="' + (data.post_title || 'Picture') + ' - 1">';

          if (data.images.length > 1) {
            for (var i = 1; i < data.images.length; i++) {
              preview_html += '<img class="fadeIn animated lazyload extra ' 
              + (post_preview_image_size||'fit-width') + '" ' 
              + 'src="data:image/gif;base64,R0lGODdhAQABAPAAAMPDwwAAACwAAAAAAQABAAACAkQBADs=" ' +
                'data-src="' + data.images[i].src + '" alt="' + (data.post_title||'Picture')+' - '+(i+1) + '">';
            }
          }

          $('#post-preview-content').html(preview_html);
          
          if (post_preview_image_size == 'fit-width' || post_preview_image_size == 'max') {
            showZoom();
            applyZoom();
          }

          // $("<img/>").on('load', function(){
          //   var file_info = $('#post-preview-file-info').text();
          //   file_info += ' - W:' + this.width + ' x H:' + this.height;
          //   $('#post-preview-file-info').text(file_info);
          // }).attr("src", data.images[0].src);

        } else {
          $('#post-preview-content').html(
            '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>'
            );
        }
      }).fail(function(data) {
        console.log(data);
        if (data.responseJSON && data.responseJSON.error) {
          $('#post-preview-content').html(
            '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>' + 
            '<span style="display: inline-block;color: white;vertical-align: middle;">' + data.responseJSON.error + '</span>'
            );
        } else {
          $('#post-preview-content').html(
            '<span style="display: inline-block;height: 100%;vertical-align: middle;"></span>'
            );
        }
      });
    }
    
    $("#previewModal").modal('show');
    loadPostComments(post_id, post_info);
  }

  var previewItem = function($item) {
    if ($item) {
      var post_id = $item.attr('data-post-id');
      var post_link = $item.attr('data-post-link');
      var post_info = {
        title: $item.attr('data-post-title'),
        permalink: $item.attr('data-post-permalink'),
        author: $item.attr('data-post-author'),
        subreddit: $item.attr('data-post-subreddit'),
        created_utc: parseInt($item.attr('data-post-created-utc'))
      };
      // console.log('Preview:', post_link);

      $('#post-preview-title').text($item.attr('data-post-title'));
      $('#post-preview-external-link-button').attr('href', post_link);
      if ($item.attr('data-post-favorite') == 'false') {
        $('#post-preview-favorite-button').html('<i class="fa fa-heart-o fa-lg fa-fw"></i>');
      } else {                
        $('#post-preview-favorite-button').html('<i class="fa fa-heart fa-lg fa-fw"></i>');
      }
      $('#post-preview-open-reddit-button').attr('href', $item.attr('data-post-permalink'));

      // $('#post-preview-file-info').text($item.attr('data-post-type').toUpperCase() 
      //   + ' - ' + $item.attr('data-post-size'));
      var index = previewable_posts_index_map[$item.index()];
      $('#post-preview-subtitle').text('' + (index+1) + ' of ' + previewable_posts_count);

      $('#post-preview-comments').html('');
      $('#post-preview-num-comments').html('<i class="fa fa-spinner fa-pulse fa-fw"></i>');
      // $('#post-preview-comments-toggle').addClass('hidden');
      $('#post-preview-comments-hide').addClass('hidden');
      $('#post-preview-comments-show').addClass('hidden');
      $('#post-preview-comments-inline').addClass('hidden');

      // $('#post-preview-title-container').removeClass('hidden');

      // if (!isSelfPost($item)) {
      //   $('#post-preview-comments-container').addClass('fixed');
      //   $('#post-preview-comments-container').removeClass('inline');
      // }

      hideZoom();

      if (isSelfPost($item)) {
        previewSelfPost($item, post_id, post_link, post_info);
      } else if (isImagePost($item)) {
        previewImagePost($item, post_id, post_link, post_info);
      } else if (isVideoPost($item)) {
        previewVideoPost($item, post_id, post_link, post_info);
      } else if (isGfycatPost($item)) {
        previewGfycatPost($item, post_id, post_link, post_info);
      } else if (isImgurPost($item)) {
        previewImgurPost($item, post_id, post_link, post_info);
      } else if (isLinkPost($item)) {
        previewLinkPost($item, post_id, post_link, post_info);
      }
    }
  }

  var previewNextItem = function() {
    var $item = getNextPreviewItem();
    if ($item) {
      $('table#items tbody tr').removeClass('info');
      $item.addClass('info');

      previewItem($item);
    }
  }

  var previewPrevItem = function() {
    var $item = getPrevPreviewItem();
    if ($item) {
      $('table#items tbody tr').removeClass('info');
      $item.addClass('info');

      previewItem($item);
    }
  }

  var hideZoom = function() {
    $('#zoom-control').addClass('hidden');
  }

  var showZoom = function() {
    $('#zoom-control').removeClass('hidden');
  }

  var resetZoom = function() {
    // $('#zoom-value').attr('data-value', '100');
    $('#post-preview-content img').css('width', 'auto');
  }

  var applyZoom = function() {
    var zoom_value = $('#zoom-value').attr('data-value');
    $('#post-preview-content img').css('width', zoom_value+'%');
  }

  var togglePreviewImageSize = function() {
    // 'fit' -> 'fit-width' -> 'fit-height' -> 'max' -> 'fit' -> ...
    if (post_preview_image_size == 'fit') {
      post_preview_image_size = 'fit-width';
      $('#post-preview-image-resize-button').html('<i class="fa fa-arrows-h fa-lg fa-fw"></i>');
      $('#post-preview-content img').removeClass('fit').addClass('fit-width');
      showZoom();
      applyZoom();
    } else if (post_preview_image_size == 'fit-width') {
      post_preview_image_size = 'fit-height';
      $('#post-preview-image-resize-button').html('<i class="fa fa-arrows-v fa-lg fa-fw"></i>');
      $('#post-preview-content img').removeClass('fit-width').addClass('fit-height');
      hideZoom();
      resetZoom();
    } else if (post_preview_image_size == 'fit-height') {
      post_preview_image_size = 'max';
      $('#post-preview-image-resize-button').html('<b style="font-size: 16px;line-height: 12px;">1:1</b>');
      $('#post-preview-content img').removeClass('fit-height').addClass('max');
      showZoom();
      applyZoom();
    } else {
      post_preview_image_size = 'fit';
      $('#post-preview-image-resize-button').html('<i class="fa fa-arrows fa-lg fa-fw"></i>');
      $('#post-preview-content img').removeClass('max').addClass('fit');
      hideZoom();
      resetZoom();
    }
  }

  // Download Post

  var downloadCurrentPost = function() {
    if (current_index != -1) {
      var $item = $('table#items tbody tr').eq(current_index);
      if ($item) {
        var post_id = $item.attr('data-post-id');
        if (post_id) downloadPost(post_id);
      }
    }
  }

  var showPreviewDownloadNotification = function(message, timeout) {
    $('#post-preview-download-notification').html(message);
    $('#post-preview-download-notification').removeClass('hidden');
    setTimeout(function() {
      $('#post-preview-download-notification').addClass('hidden');
      $('#post-preview-download-notification').html('');
    }, timeout || 3000);
  }

  var downloadPost = function(post_id) {
    $('#post-preview-download-button').html('<i class="fa fa-spinner fa-pulse fa-lg fa-fw"></i>');
    // console.log('Download post:', post_id);
    $.post('/download?post_id=' + post_id, function(data) {
      $('#post-preview-download-button').html('<i class="fa fa-download fa-lg fa-fw"></i>');
      console.log(data);
      if (data && data.downloaded) {
        showPreviewDownloadNotification('Downloaded!');
      } else if (data && data.error) {
        showPreviewDownloadNotification(data.error);
      }
    });
  }

  // Favorite & Unfavorite Post

  var toggleCurrentPostFavorite = function() {
    if (current_index != -1) {
      var $item = $('table#items tbody tr').eq(current_index);
      if ($item) {
        var post_id = $item.attr('data-post-id');
        if (post_id && $item.attr('data-post-favorite') == 'false') {
          favoritePost(post_id, function(favorited) {
            if (favorited) $item.attr('data-post-favorite', 'true');
          });
        } else if (post_id) {
          unfavoritePost(post_id, function(unfavorited) {
            if (unfavorited) $item.attr('data-post-favorite', 'false');
          });
        }
      }
    }
  }

  var showPreviewFavoriteNotification = function(message, timeout) {
    $('#post-preview-favorite-notification').html(message);
    $('#post-preview-favorite-notification').removeClass('hidden');
    setTimeout(function() {
      $('#post-preview-favorite-notification').addClass('hidden');
      $('#post-preview-favorite-notification').html('');
    }, timeout || 3000);
  }

  var favoritePost = function(post_id, done) {
    $('#post-preview-favorite-button').html('<i class="fa fa-spinner fa-pulse fa-lg fa-fw"></i>');
    // console.log('Download post:', post_id);
    $.post('/favorite?post_id=' + post_id, function(data) {
      console.log(data);
      if (data && data.favorited) {
        $('#post-preview-favorite-button').html('<i class="fa fa-heart fa-lg fa-fw"></i>');
        showPreviewFavoriteNotification('Favorited!');
        return done(true);
      } else if (data && data.error) {
        $('#post-preview-favorite-button').html('<i class="fa fa-heart-o fa-lg fa-fw"></i>');
        showPreviewFavoriteNotification(data.error);
      } else {
        $('#post-preview-favorite-button').html('<i class="fa fa-heart-o fa-lg fa-fw"></i>');
      }
      return done();
    });
  }

  var unfavoritePost = function(post_id, done) {
    $('#post-preview-favorite-button').html('<i class="fa fa-spinner fa-pulse fa-lg fa-fw"></i>');
    // console.log('Download post:', post_id);
    $.post('/unfavorite?post_id=' + post_id, function(data) {
      console.log(data);
      if (data && data.unfavorited) {
        $('#post-preview-favorite-button').html('<i class="fa fa-heart-o fa-lg fa-fw"></i>');
        showPreviewFavoriteNotification('Unfavorited!');
        return done(true);
      } else if (data && data.error) {
        $('#post-preview-favorite-button').html('<i class="fa fa-heart fa-lg fa-fw"></i>');
        showPreviewFavoriteNotification(data.error);
      } else {
        $('#post-preview-favorite-button').html('<i class="fa fa-heart fa-lg fa-fw"></i>');
      }
      return done();
    });
  }

  /* Post Preview Events */

  var windowHeight = function() {
    return window.innerHeight ? window.innerHeight : $(window).height();
  }

  var closePreviewModal = function() {
    if ($('#previewModal').hasClass('in')) {
      $('#previewModal').modal('toggle');
      $('#post-preview-content').html('');
    }
  }

  $('#previewModal').on('show.bs.modal', function () {
    is_previewing = true;
    // $('#previewModal .modal-body').css('overflow-y', 'auto'); 
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
      $('#previewModal .modal-body').css('height', windowHeight());
      $('#post-preview-comments').css('height', windowHeight() - 60);
    } else {
      $('#previewModal .modal-body').css('height', windowHeight() - 15);
      $('#post-preview-comments').css('height', windowHeight() - 75);
    }
  });

  $('#previewModal').on('hide.bs.modal', function () {
    is_previewing = false;
    $('#post-preview-content').html('');
  });

  $(window).resize(function() {
    if (is_previewing) {
      if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
        $('#previewModal .modal-body').css('height', windowHeight());
        $('#post-preview-comments').css('height', windowHeight() - 60);
      } else {
        $('#previewModal .modal-body').css('height', windowHeight() - 15);
        $('#post-preview-comments').css('height', windowHeight() - 75);
      }
    }
  });

  $(document).on('keydown', function (event) {
    // console.log('Keydown:', event.keyCode || event.which);
    if (is_previewing) {
      if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
      var keycode = event.keyCode || event.which;
      if (keycode == 37) { // left
        previewPrevItem();
      } else if (keycode == 39) { // right
        previewNextItem();
      } else if (keycode == 27) { // esc
        closePreviewModal();
      } else if (keycode == 68) { // 'd'
        if (!$('#post-preview-download-button').hasClass('hidden')) {
          downloadCurrentPost();
        }
      } else if (keycode == 70) { // 'f' 
        toggleCurrentPostFavorite();
      } else if (keycode == 67) { // 'c' 
        toggleComments();
      } else if (keycode == 83) { // 's' 
        togglePreviewImageSize();
      }
    }
  });

  $('#post-preview-content').on('click', function(event) {
    event.preventDefault();
    // if ($('#post-preview-actions').hasClass('hidden')) {
    //   $('#post-preview-title-container').removeClass('hidden');
    // } else {
    //   $('#post-preview-title-container').addClass('hidden');
    // }
    if ($('#post-preview-content').find('video').length) {
      return;
    }
    $('#post-preview-actions').toggleClass('hidden');
    $('#post-preview-left a').toggleClass('hidden');
    $('#post-preview-right a').toggleClass('hidden');
    $('#post-preview-title-container').toggleClass('hidden');
    // $('#post-preview-comments-container').toggleClass('hidden');
    if (post_preview_image_size == 'fit-width' || post_preview_image_size == 'max') {
      $('#zoom-control').toggleClass('hidden');
    }
  });

  $('#post-preview-next').on('click', function(event) {
    event.preventDefault();
    previewNextItem();
  });

  $('#post-preview-prev').on('click', function(event) {
    event.preventDefault();
    previewPrevItem();
  });

  $('#post-preview-right').on('click', function(event) {
    event.preventDefault();
    previewNextItem();
  });

  $('#post-preview-left').on('click', function(event) {
    event.preventDefault();
    previewPrevItem();
  });

  $('#post-preview-download-button').on('click', function(event) {
    event.preventDefault();
    downloadCurrentPost();
  });

  $('#post-preview-favorite-button').on('click', function(event) {
    event.preventDefault();
    toggleCurrentPostFavorite();
  });

  $('#post-preview-image-resize-button').on('click', function(event) {
    event.preventDefault();
    togglePreviewImageSize();
  });

  $('#post-preview-close-button').on('click', function(event) {
    event.preventDefault();
    closePreviewModal();
  });
  $('#post-preview-close').on('click', function(event) {
    event.preventDefault();
    closePreviewModal();
  });

  $('table#items tbody tr').each(function() {
    var $item = $(this);

    if (isImagePost($item) || isVideoPost($item) || isSelfPost($item) || isLinkPost($item) 
      || isGfycatPost($item) || isImgurPost($item)) {
      previewable_posts_index_map[$item.index()] = previewable_posts_count;
      previewable_posts_count++;
    }
  });

  $('table#items tbody tr').on('click', function(event) {
    // event.preventDefault();
    var $item = $(this);

    if (isImagePost($item) || isVideoPost($item) || isSelfPost($item) || isLinkPost($item) 
      || isGfycatPost($item) || isImgurPost($item)) {
      $('table#items tbody tr').removeClass('info');
      $item.addClass('info');

      current_index = $item.index();
      // console.log('Index:', $(this).index());

      previewItem($item);
    }
  });

  $('#post-preview-file-info-toggle').on('click', function() {
    $('#post-preview-file-info').toggleClass('hidden');
  });

  $('#zoom-control #zoom-in').on('click', function(event) {
    event.preventDefault();
    var zoom_value = $('#zoom-value').attr('data-value');
    zoom_value = parseInt(zoom_value);
    if (!isNaN(zoom_value)) {
      zoom_value += 5;
      if (post_preview_image_size == 'fit-width' && zoom_value >= 100) {
        zoom_value = 100;
        $('#zoom-control #zoom-in').addClass('disable');
      } else {
        $('#zoom-control #zoom-in').removeClass('disable');
      }
      $('#zoom-value').attr('data-value', zoom_value);
      $('#post-preview-content img').css('width', zoom_value+'%');
    }
  });

  $('#zoom-control #zoom-out').on('click', function(event) {
    event.preventDefault();
    var zoom_value = $('#zoom-value').attr('data-value');
    zoom_value = parseInt(zoom_value);
    if (!isNaN(zoom_value)) {
      zoom_value -= 5;
      if (zoom_value <= 10) {
        zoom_value = 10;
        $('#zoom-control #zoom-out').addClass('disable');
      } else {
        $('#zoom-control #zoom-out').removeClass('disable');
      }
      $('#zoom-value').attr('data-value', zoom_value);
      $('#post-preview-content img').css('width', zoom_value+'%');
    }
  });

  /* Comments */

  var toggleComments = function() {
    if ($('#post-preview-comments').hasClass('hidden')) { // comments will be shown
      $('#post-preview-comments').removeClass('hidden');
      $('#post-preview-container').addClass('to-right');
      // $('#post-preview-comments-align').removeClass('hidden');
      // $('#post-preview-comments-align').html('<i class="fa fa-long-arrow-left fa-fw"></i>');
    } else { // comments will be hidden
      $('#post-preview-comments').addClass('hidden');
      // $('#post-preview-comments-align').addClass('hidden');
      if ($('#post-preview-container').hasClass('to-right')) {
        $('#post-preview-container').removeClass('to-right');
        // $('#post-preview-comments-align').html('<i class="fa fa-long-arrow-right fa-fw"></i>');
      }
    }
  }

  $('#post-preview-comments-toggle').on('click', function(event) {
    event.preventDefault();
    toggleComments();
  });

  $('#post-preview-comments-align').on('click', function(event) {
    event.preventDefault();
    if ($('#post-preview-container').hasClass('to-right')) {
      $('#post-preview-container').removeClass('to-right');
      $('#post-preview-comments-align').html('<i class="fa fa-long-arrow-right fa-fw"></i>');
    } else {
      $('#post-preview-container').addClass('to-right');
      $('#post-preview-comments-align').html('<i class="fa fa-long-arrow-left fa-fw"></i>');
    }
  });

  $('#post-preview-comments-inline').on('click', function(event) {
    event.preventDefault();
    if ($('#post-preview-comments-container').hasClass('fixed')) {
      $('#post-preview-comments-container').removeClass('fixed');
      $('#post-preview-comments-container').addClass('inline');
    } else {
      $('#post-preview-comments-container').removeClass('inline');
      $('#post-preview-comments-container').addClass('fixed');
    }
  });

  $('#post-preview-comments-hide').on('click', function(event) {
    event.preventDefault();
    $('#post-preview-comments').addClass('hidden');
    $('#post-preview-comments-hide').addClass('hidden');
    $('#post-preview-comments-show').removeClass('hidden');
  });
  $('#post-preview-comments-show').on('click', function(event) {
    event.preventDefault();
    $('#post-preview-comments').removeClass('hidden');
    $('#post-preview-comments-show').addClass('hidden');
    $('#post-preview-comments-hide').removeClass('hidden');
  });

});
