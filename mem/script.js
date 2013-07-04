var width = 900,
    height = 400,
    margin = {top: 10, right: 40, bottom: 20, left: 50};

var detail_elem = document.getElementById('detail');
var text_details_elem = document.getElementById('text-details');

/// d3 helpers.
function Plot(elem, width, height, margin) {
  return d3.select(elem).append("svg")
               .attr("width", width + margin.left + margin.right)
               .attr("height", height + margin.top + margin.bottom)
             .append("g")
               .attr("transform", "translate(" + margin.left + "," + margin.top + ")");
}

function Line(x_scale, x_access, y_scale, y_access) {
  return d3.svg.line()
     .x(function(d) { return x_scale(x_access(d)); })
     .y(function(d) { return y_scale(y_access(d)); });
}
function Axis(scale, orient) {
  return d3.svg.axis().scale(scale).orient(orient)
}

function DrawAxis(svg, axis, text, klass, opts) {
  opts = opts || {};
  var g = svg.append("g")
    .attr("class", "axis " + klass)
    .attr("transform", "translate(" + (opts['translate-x'] || 0) +
          "," + (opts['translate-y'] || 0) + ")");
  g.call(axis);
  if (text) {
    g.append("text")
      .attr("transform", "rotate(" + (opts['rotate'] || '0') + ")")
      .attr("dy", opts['dy'] || '0pt')
      .style("text-anchor", opts['text-anchor'] || 'end')
      .text(text);
  }
  return g;
}

/// A label for a commit + (optional) associated pr
function Label(d, linkify) {
  function wrap(link, text) {
    return linkify ? '<a href="' + link + '">' + text + '</a>' : text;
  }
  var ret = wrap('https://github.com/mozilla/rust/commit/' + d.hash, d.hash.substr(0, 7));
  if (d.pull_request) {
    ret += ' (' +
         wrap('https://github.com/mozilla/rust/pull/' + d.pull_request,'#' + d.pull_request) + ')';
  }
  return ret;
}

/// Construct the little box on the side
function TextDetail(hash, data) {
  function li(contents, klass) {
    var l = document.createElement('li');
    l.innerHTML = contents;
    l.classList.add(klass);
    return l;
  }

  var text = document.createElement('li');
  text.classList.add('text-detail');
  text.id = 'text-' + hash;
  text.dataset.hash = hash;
  text.dataset.timestamp = data.summary.timestamp;

  var h2 = document.createElement('h2');
  h2.innerHTML = Label(data.summary, true);
  text.appendChild(h2);

  var clear = document.createElement('div');
  clear.classList.add('clear-button');
  clear.classList.add('button');
  clear.innerHTML = '✘';
  clear.title = 'Remove this series';
  clear.addEventListener('click', function() { detail_toggle(hash, true) });
  text.appendChild(clear);

  var keep = document.createElement('div');
  keep.classList.add('keep-button');
  keep.classList.add('button');
  keep.innerHTML = '✔';
  keep.title = 'Keep only this series';
  keep.addEventListener('click', function() { detail_keep_only(hash) });
  text.appendChild(keep);

  var ul = document.createElement('ul');
  text.appendChild(ul);

  if (data.summary.pull_request !== null) {
    var pr = data.summary.pull_request;
    var contents = pr_title_cache.has(pr) ? pr_title_cache.get(pr) : '';
    var l = li(contents, 'pr-title');
    if (contents == '') {
      l.id = 'pr-title-' + pr;
      l.classList.add('hidden');
      var script = document.createElement('script');
      script.src = 'https://api.github.com/repos/mozilla/rust/pulls/' + pr + '?callback=pr_callback';
      document.body.appendChild(script);
    }
    ul.appendChild(l);
  }

  var date = new Date(data.summary.timestamp * 1000)
             .toISOString().replace(/\.[0-9]{3}Z/, '').replace('T', ' ');
  ul.appendChild(li('Date: ' + date, 'date-text'))
  ul.appendChild(
    li('Max memory usage: ' + (data.summary.max_memory/(1024*1024)).toFixed(0) + ' MiB', 'mem-text'))
  ul.appendChild(li('CPU time: ' + data.summary.cpu_time.toFixed(1) + ' s', 'cpu-text'));

  // insert in order of date
  for (var i = 0, l = text_details_elem.childNodes.length; i < l; i++) {
    var node = text_details_elem.childNodes[i];
    if (data.summary.timestamp < parseInt(node.dataset.timestamp)) {
      text_details_elem.insertBefore(text, node);
      return;
    }
  }
  // no smaller element, so just append.
  text_details_elem.appendChild(text);
}

// use the github api to get the titles of the PRs, but cache it, so
// we're not hitting the api and the network constantly
var pr_title_cache = d3.map();
function pr_callback(json) {
  var data = json.data;
  if (data) {
    var id = 'pr-title-' + data.number;
    var span = document.getElementById(id);
    span.innerHTML = data.title;
    pr_title_cache.set(data.number, data.title);
    span.classList.remove('hidden');
  }
}

/// Convert a hash to a colour. This gives less nice results than
/// using one of the d3 ones, but they are stable.
function hash_to_colour(hash) {
  var r = parseInt(hash.substr(0, 2), 16),
      g = parseInt(hash.substr(2, 2), 16),
      b = parseInt(hash.substr(4, 2), 16);

  return 'rgb('+[r,g,b].join(',')+')';
}

/// Toggle whether a certain hash is displayed on the detailed plot.
var dt = (function() {
    var detail = Plot("#detail", width, height, margin);
    var x = d3.scale.linear().range([0, width]);
    var x_axis = Axis(x, "bottom");
    var y = d3.scale.linear().range([height, 0]);
    var y_axis = Axis(y, "left");

    DrawAxis(detail, x_axis, '', 'x detail', {'translate-y': height});
    DrawAxis(detail, y_axis, 'Memory (MiB)', 'y detail', {'dy': '1.3em', 'rotate': '-90'});

    var detail_lines = detail.append("g");
    var line = Line(x, d_time, y, d_mem);

    function d_time(d) { return d[0]; }
    function d_mem(d) { return d[1] / (1024 * 1024); }

    // cache for the detailed information, again to avoid hitting the
    // network.
    var detail_cache = d3.map();

    // the commits that currently are shown in detail. Actually maps
    // hash to (max memory usage, elapsed time), to make bounds
    // calculations faster.
    var visible_details = d3.map();

    /// register the clear all button handler here, since the
    /// visible_details object is only in scope here.
    var clear_all = document.getElementById('clear-all');
    clear_all.addEventListener('click', function() {
      visible_details.keys().forEach(function(hash) {
        detail_toggle(hash, true);
      });
    })

    var toggle = function(hash, adjust_hash) {
      if (detail_cache.has(hash)) {
        inner(detail_cache.get(hash));
      } else {
        d3.json("out/" + hash + ".json", function(e,d) {
          if (e) {
            console.warn("Error getting details", e);
            return;
          }

          detail_cache.set(hash, d);
          inner(d)
        });
      }

      function inner(data) {
        if (visible_details.has(hash)) {
          // already visible, so remove it
          setColour(hash, '');
          visible_details.remove(hash);
          var text = document.getElementById('text-' + hash);
          text.parentNode.removeChild(text);
        } else {
          // not visible, so register it and it's description.
          var x_max = d3.max(data.memory_data, d_time),
              y_max = d3.max(data.memory_data, d_mem);
          visible_details.set(hash, {y: y_max, x: x_max});
          TextDetail(hash, data)
        }

        // update the hash & plots for the above change.

        if (adjust_hash) {
          var new_hash = visible_details.keys().map(function(s) {return s.substr(0, 7)}).join(',');
          window.location.replace('#' + new_hash);
        }

        var x_max = d3.max(visible_details.values(), function(d) {return d.x}),
            y_max = d3.max(visible_details.values(), function(d) {return d.y});
        x.domain([0, x_max]).nice();
        y.domain([0, y_max]).nice();

        // colour the summary markers and the text detail border
        visible_details.forEach(function (hash) {
          setColour(hash, hash_to_colour(hash));
        })

        detail.select(".x.axis").call(x_axis);
        detail.select(".y.axis").call(y_axis);

        [['line', 'path', draw_line],
         ['time-tick', 'line', draw_tick]].forEach(function(v) {
          var selection = detail_lines.selectAll('.detail.' + v[0]).data(visible_details.keys());
          // update existing lines
          selection.call(v[2]);
          // add new lines
          selection.enter().append(v[1]).call(v[2]);
          // remove old ones
          selection.exit().remove();
        })

        // hide the graph if it's empty
        if (visible_details.keys().length == 0) {
          detail_elem.classList.add('hidden');
        } else {
          detail_elem.classList.remove('hidden');
        }

        function draw_line(selection) {
          selection
            .style('stroke', function(hash) { return hash_to_colour(hash); })
            .datum(function(hash) { return detail_cache.get(hash).memory_data; })
            .attr('class', 'line detail')
            .attr('d', line);
        }
        function draw_tick(selection) {
          selection
            .style('stroke', function(hash) { return hash_to_colour(hash); })
            .attr('class', 'time-tick detail')
            .attr('x1', function(hash) { return x(detail_cache.get(hash).summary.cpu_time); })
            .attr('x2', function(hash) { return x(detail_cache.get(hash).summary.cpu_time); })
            .attr('y1', height - 20)
            .attr('y2', height);
        }

        function setColour(hash, colour) {
          d3.select('#marker-' + hash).style('fill', colour);
          d3.select('#marker-' + hash + ' .marker-line').style('stroke', colour);
          document.getElementById('text-' + hash).style.borderColor = colour;
        }
      }
    };

    var keep_only = function(hash) {
      visible_details.forEach(function (other_hash) {
        if (other_hash != hash) toggle(other_hash, true)
      });
    };
    return [toggle, keep_only];

})();

var detail_toggle = dt[0], detail_keep_only = dt[1];

// drawing the main summary plot
(function() {
    var summary = Plot("#summary", width, height, margin);

    var x = d3.time.scale()
        .range([0, width]);

    var y_mem = d3.scale.linear().range([height, 0]);
    var y_cpu_time = d3.scale.linear().range([height, 0]);

    var xAxis = Axis(x, "bottom");

    var yAxis_mem = Axis(y_mem, "left");
    var yAxis_cpu_time = Axis(y_cpu_time, "right");

    function time(d) { return d.timestamp * 1000; }
    function mem(d) { return d.max_memory / (1024 * 1024); }
    function cpu_time(d) { return d.cpu_time; }

    var line_mem = Line(x, time, y_mem, mem);
    var line_cpu_time = Line(x, time, y_cpu_time, cpu_time);

    d3.json("out/summary.json", function(err, data) {
      var x_low = d3.min(data, time),
          x_high = Date.now(),
          dx = x_high - x_low;

      x.domain([x_low - 0.03*dx, x_high]);
      y_mem.domain([0, d3.max(data, mem)]);
      y_mem.nice();
      y_cpu_time.domain([0, d3.max(data, cpu_time)]);
      y_cpu_time.nice();

      DrawAxis(summary, xAxis, '', 'x', {'translate-y': height});
      DrawAxis(summary, yAxis_mem, 'Peak Memory (MiB)', 'y mem', {
        'rotate': '-90',
        'dy': '1.3em'
      });
      DrawAxis(summary, yAxis_cpu_time, 'CPU Time (s)', 'y cpu', {
        'rotate': '-90',
        'translate-x': width,
        'dy': '-.9em'
      });

      // vertical lines go under the graphs
      var lines = summary.append('g');

      summary.append("path")
          .datum(data)
          .attr("class", "line cpu")
          .attr("d", line_cpu_time);
      summary.append("path")
          .datum(data)
          .attr("class", "line mem")
          .attr("d", line_mem);

      // a map from the first 7 letters of each commit hash to the
      // whole thing, used for the URL #
      var short2long = d3.map();

      // draw the vertical lines for each commit
      data.forEach(function(d) {
        var xx = x(time(d));
        var g = lines.append('g')
           .attr("transform", "translate(" + xx +", 0)")
           .attr('id', 'marker-' + d.hash)
           .attr('class', 'marker')
           .on('click', function () {
                  detail_toggle(d.hash, true)
                });

        // the line portion
        g.append('line')
           .attr('class', 'marker-line')
           .attr('x1', 0).attr('x2', 0)
           .attr('y1', height).attr('y2', 0);

        // the text portion
        var label = Label(d, false);

        g.append('text')
          .attr("class", "hash")
          .attr("transform", "rotate(-90)")
          .attr('x', -height)
          .attr("dy", "0.3em")
          .attr("dx", "1em")
          .style("text-anchor", "start")
          .text(label);

        short2long.set(d.hash.substr(0, 7), d.hash);
      })

      // if the hash looks like #somehash,somehash,somehash, try to
      // prefill the detailed plot
      if (/^#[a-z0-9,]+$/.test(window.location.hash)) {
        window.location.hash.substr(1).split(',').forEach(function (hash_prefix) {
          if (hash_prefix.length >= 7) { // ignore things that are too short
            detail_toggle(short2long.get(hash_prefix.substr(0, 7)));
          } else {
            console.warn("Hash prefix must to be >= 7 chars: '" + hash_prefix + "'");
          }
        })
      } else {
        // draw the last one
        detail_toggle(data[data.length - 1].hash, false)
      }
    })
})();
