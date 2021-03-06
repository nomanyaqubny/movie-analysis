//-----------------------------------------------------------------------------
// Copyright (c) 2015, IBM Corp.
// All rights reserved.
//
// Distributed under the terms of the BSD Simplified License.
//
// The full license is in the LICENSE file, distributed with this software.
//
// You may not use this file except in compliance with the License.
//------------------------------------------------------------------------------

$body = $("body");
$(document).on({
    ajaxStart: function() { $body.addClass("loading");    },
    ajaxStop: function() { $body.removeClass("loading"); }    
});

$(document).ready(function() { 
  init();
});

function init() {
	getAllMovies();
}

function getAllMovies() {
  // jQuery AJAX call for JSON
  $.getJSON('/movie/get/all', function(result) {
    console.log(result)
    if(!result.err && result.data) {
    	appendOptions(result.data);
    } else {
      $('.message').append('<div class="message-box message-err">Movie list is empty</div>');
    }
  });
  return false;
};

function appendOptions(selectValues) {
  var select = $('#select-movie-list');
  select.empty();
	$.each(selectValues, function(key, value) {
    $(select)
	    .append($("<option></option>")
      .attr("value",key)
      .text(value)); 
	});
}

$('#btn-visualize').click(function() {
  $('#btn-visualize').removeClass('blinkMe');
  var url = "movie/box-office/" + $('#select-movie-list option:selected').val();
  window.location.href = url;
});

$('#btn-retrieve').click(function() {
  var searchMovieString = $(".search-movie").val();
  var searchTwitterString = $(".search-twitter").val();
  if (searchMovieString) {
    loadMovieData(searchMovieString, searchTwitterString);
  } else {
    $('.search-movie').addClass('warning');
    $('.search-twitter').addClass('warning');
  }
});

function loadMovieData(movieTitle, twitterQuery) {
  $.ajax({
    url : '/movie/load/search',
    async : false,
    data : {
      boxOffice: movieTitle,
      twitter: twitterQuery
    },
    success: function(result) {
      if(!result.err && result.data) {
        $('.message').append('<div class="message-box message-success">Title: ' + (result.data.theNumbers ? result.data.theNumbers.name : "null") +  ', Box Office Entries : ' + result.data.theNumbers.performance.length
         + ', Tweets Count: ' + (result.data.twitterInsights ? result.data.twitterInsights.count : "null") + '</div>');
      } else {
        $('.message').append('<div class="message-box message-err">'+result.data.message+'</div>');
      }
      $('.search-movie').removeClass('warning');
      $('.search-twitter').removeClass('warning');
      $('.message-box').fadeOut(100000, 'linear');
    }
  });
  return false;
}

function insertReplaceMovieDataCallback(result) {
  if(!result.err && result.data) {

    $('#select-movie-list').append($('<option>', {
      value: result.data.uri,
      text: result.data.title
    }));
    $('#select-movie-list').val(result.data.uri)
    $('#btn-visualize').addClass('blinkMe');


    $('.message').append('<div class="message-box message-success">Tweets Count: ' + result.data.twitterInsights.count +
      ' Box Office Entries : ' + result.data.theNumbers.data + '</div>');
  } else {
    $('.message').append('<div class="message-box message-err">'+result.data.message+'</div>');
    $('.message-box').fadeOut(100000, 'linear');
  }
  $('.search-movie').removeClass('warning');
  $('.search-twitter').removeClass('warning');
}

$('#btn-insert-replace').click(function(e) {
  var movieTitle = $(".search-movie").val();
  var twitterQuery = $(".search-twitter").val();
  if(movieTitle) {
    $.ajax({
      type: 'GET',
      url: '/movie/replace/query',
      data: {
        boxOffice: movieTitle,
        twitter: twitterQuery
      },
      async: false,
      dataType: 'json',
      success: insertReplaceMovieDataCallback,
      error: function(x, t, m) {
        if(t==="timeout") {
            console.log("got timeout");
        } else {
            console.log(t);
            console.log(x);
            console.log(m);
        }
      },
      timeout: 360000000 //60 minutes
      // progress: function(evt) {
      //     if (evt.lengthComputable) {
      //         console.log("Loaded " + parseInt( (evt.loaded / evt.total * 100), 10) + "%");
      //     }
      //     else {
      //         console.log("Length not computable.");
      //     }
      // },
      // progressUpload: function(evt) {
      //   // See above
      // }
    });
  } else {
    $('.search-movie').addClass('warning');
    $('.search-twitter').addClass('warning');
  }
  // e.stopImmediatePropagation();
  e.preventDefault();
  return false;
});

$('#btn-delete').click(function(e) {
  var movieName = $('#select-movie-list option:selected').text();
  var ask = confirm("Delete "+movieName+"! Are you sure?");
  if (ask == true) {
      $.ajax({
        type: 'GET',
        url: '/movie/delete/'+movieName,
        dataType: 'json',
        success: deleteMovieDataCallback,
        error: deleteMovieDataCallback
    });
  }
  e.preventDefault();
  return false;
});

function deleteMovieDataCallback(result) {
  if(!result.err && result.data) {
    $('.message').append('<div class="message-box message-success">Movie Deleted</div>');
    getAllMovies();
  } else {
    $('.message').append('<div class="message-box message-err">Error in Deletion</div>');
  }
  $('.message-box').fadeOut(100000, 'linear');
}