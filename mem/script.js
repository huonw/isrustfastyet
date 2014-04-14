var width = 870,
    height = 400,
    margin = {top: 10, right: 40, bottom: 20, left: 50};

var TRANSITION_DURATION = 200;

var summary_elem = document.getElementById('summary');
var detail_elem = document.getElementById('detail');
var text_details_elem = document.getElementById('text-details');

function AxisBounds(data, lo, hi, x_access, y_access) {
  var min = Infinity,
      max = -Infinity,
      hi_lo_x = -Infinity, // the largest x value smaller than lo
      hi_lo_y = 0,
      lo_hi_x = -Infinity, // the largest x value larger than hi
      lo_hi_y = 0;

  x_access = x_access || function(d) { return d; }
  y_access = y_access || function(d) { return d; }

  for (var i = 0, l = data.length; i < l; i++) {
    var x = x_access(data[i]),
        y = y_access(data[i]);
    if (x < lo) {
      if (x > hi_lo_x) {
        hi_lo_x = x;
        hi_lo_y = y;
      }
    } else if (x > hi) {
      if (x < lo_hi_x) {
        lo_hi_y = y;
        lo_hi_x = x;
      }
    } else {
      if (y < min) min = y;
      if (y > max) max = y;
    }
  }
  return [Math.min(hi_lo_y, min, lo_hi_y),
          Math.max(hi_lo_y, max, lo_hi_y)];
}


/// d3 helpers.
function Plot(elem, width, height, margin, x_axis, zoom_func, reset_zoom) {
  var e = d3.select(elem);
  var svg = e.append("svg");
  var reset = document.createElement('div');
  reset.classList.add('reset-button');
  reset.classList.add('hidden');
  reset.textContent = 'Reset zoom';
  reset.addEventListener('click', function() {
    this.classList.add('hidden')
    reset_zoom();
  });
  e.node().appendChild(reset);

  var zoom = d3.behavior.zoom().x(x_axis)
    .scaleExtent([1.0/4000, 4000])
    .on('zoom',
        function() {
          reset.classList.remove('hidden');
          d3.event.sourceEvent.stopPropagation();
          d3.event.sourceEvent.preventDefault();
          zoom_func();
        });
  svg.call(zoom);

  var clip_id = 'clipper-' + Math.random();
  svg.append('defs').append('clipPath').attr('id', clip_id)
    .append('rect')
     .attr('x', -1)
     .attr('y', -1)
     .attr('width', width + 1)
     .attr('height', height + 1)
     .attr('class', 'clipper')
     .attr('id', clip_id);
  var main_box = svg.attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
      .append("g")
      .attr("transform", "translate(" + margin.left + "," + margin.top + ")")
  var subbox = main_box.append('g').attr('clip-path', 'url(#' + clip_id + ')');
  return {
    zoom: zoom,
    main: main_box,
    clipped: subbox
  };
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

function VerticalLine(svg, x, label, opts) {
  opts = opts || {};
  var g = svg.append('g')
           .attr("transform", "translate(" + x +", 0)")
           .attr('id', opts.id || '')
           .attr('class', opts['class'] || '')
           .on('click', opts.click || function() {});

  // the line portion
  g.append('line')
    .attr('class', opts['line-class'] || '')
    .attr('x1', 0).attr('x2', 0)
    .attr('y1', opts.height || height).attr('y2', 0);

  g.append('text')
    .attr("class", opts['text-class'] || '')
    .attr("transform", "rotate(-90)")
    .attr('x', -(opts.height || height))
    .attr("dy", opts.dy || '')
    .attr("dx", "1em")
    .style("text-anchor", "start")
    .text(label);
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

function Control(text, klass, title, onclick) {
  var e =  document.createElement('span');
  e.classList.add(klass);
  e.classList.add('control');
  e.innerHTML = text;
  e.title = title;
  e.addEventListener('click', onclick);
  return e;
}

function HoverEmphasisers(hash) {
  return [
    function() {
      var line = document.getElementById('detail-line-' + hash),
          text = document.getElementById('text-' + hash);
      if (line) line.classList.add('hovered');
      if (text) text.classList.add('hovered');
    },
    function() {
      var line = document.getElementById('detail-line-' + hash),
          text = document.getElementById('text-' + hash);
      if (line) line.classList.remove('hovered');
      if (text) text.classList.remove('hovered');
    }];
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
  var hoverers = HoverEmphasisers(hash);
  text.addEventListener('mouseover', hoverers[0]);
  text.addEventListener('mouseout', hoverers[1]);

  var h2 = document.createElement('h2');
  h2.innerHTML = Label(data.summary, true);
  text.appendChild(h2);

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
  var cpu_text = data.summary.cpu_time ? (data.summary.cpu_time.toFixed(1) + ' s') : 'not measured';
  ul.appendChild(li('CPU time: ' + cpu_text, 'cpu-text'));

  var controls = document.createElement('div');
  controls.classList.add('text-detail-controls');
  text.appendChild(controls);

  if (data.pass_timing && data.pass_timing.length > 0) {
    var passes = document.createElement('label');
    passes.classList.add('passes-box');
    passes.classList.add('control');
    var check = document.createElement('input');
    check.id = 'passes-check-' + hash;
    check.type = 'checkbox';
    check.addEventListener('change', function() {
      var func = this.checked ? 'remove' : 'add';
      document.getElementById('pass-' + hash).classList[func]('hidden');
    });

    passes.appendChild(check);
    passes.appendChild(document.createTextNode(' passes'));
    controls.appendChild(passes);
  }

  controls.appendChild(Control('✔', 'keep-button', 'Keep only this series',
                               function() { detail_keep_only(hash) }));

  controls.appendChild(Control('✘', 'clear-button', 'Remove this series',
                              function() { detail_toggle(hash, true) }));

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
    pr_title_cache.set(data.number, data.title);
    var span = document.getElementById(id);
    if (span) {
      span.innerHTML = data.title;
      span.classList.remove('hidden');
    }
  }
}

/// Convert a hash to a colour. This gives less nice results than
/// using one of the d3 ones, but they are stable.
function hash_to_colour(hash) {
  return '#' + hash.substr(0, 6);
}

function setColour(hash, colour) {
  d3.selectAll('.marker-' + hash).style('fill', colour);
  d3.selectAll('.line-' + hash).style('stroke', colour);

  d3.select('#text-' + hash).style('border-color', colour);
}

// the commits that currently are shown in detail. Actually maps
// hash to (max memory usage, elapsed time), to make bounds
// calculations faster.
var visible_details = d3.map();

/// Toggle whether a certain hash is displayed on the detailed plot.
var dt = (
  function() {
    var x = d3.scale.linear().range([0, width]),
        x_axis = Axis(x, "bottom"),
        y = d3.scale.linear().range([height, 0]),
        y_axis = Axis(y, "left"),
        zmc = Plot("#detail", width, height, margin, x, zoom_func, reset_zoom),
        zoom = zmc.zoom, main = zmc.main, clipped = zmc.clipped;

    DrawAxis(main, x_axis, '', 'x detail', {'translate-y': height});
    DrawAxis(main, y_axis, 'Memory (MiB)', 'y detail', {'dy': '1.3em', 'rotate': '-90'});

    var detail_lines = clipped.append("g");
    var line = Line(x, d_time, y, d_mem);

    function d_time(d) { return d[0]; }
    function d_mem(d) { return d[1] / (1024 * 1024); }

    // cache for the detailed information, again to avoid hitting the
    // network.
    var detail_cache = d3.map();

    /// Whether the user is currently in control of the zoom level.
    var hand_zoomed = false;

    /// register the clear all button handler here, since the
    /// reset_zoom function is only in scope here.
    var clear_all = document.getElementById('clear-all');
    clear_all.addEventListener('click', function() {
      visible_details.keys().forEach(function(hash) {
        setColour(hash, '');
      });
      visible_details = d3.map(); // clear it
      detail_lines.selectAll('.detail').remove();
      d3.select(document).selectAll('.text-detail').remove();
      d3.selectAll('.detail-visible').each(function() { this.classList.remove('detail-visible'); })
      window.location.replace('#');
      detail_elem.classList.add('hidden');
      reset_zoom();
    })

    function zoom_func() {
      hand_zoomed = true;
      draw();
    }
    function reset_zoom() {
      hand_zoomed = false;
      draw();
    }

    function draw() {
      if (!hand_zoomed) {
        // only update the x-axis if we're at the default view, and
        // the person hasn't zoomed, since this resets the zoom.'
        var x_max = d3.max(visible_details.values(), function(d) {return d ? d.x : 0});
        x.domain([0, x_max]).nice();
        zoom.x(x);
      }

      var x_lo = x.invert(0), x_hi = x.invert(width),
          y_max = Math.max.apply(null, visible_details.keys().map(
            function(hash) {
              return AxisBounds(detail_cache.get(hash).memory_data,
                         x_lo, x_hi, d_time, d_mem)[1];
            }));
      y.domain([0, y_max * 1.01]).nice();

      main.select(".x.axis").transition().duration(TRANSITION_DURATION / 2).call(x_axis);
      main.select(".y.axis").transition().duration(TRANSITION_DURATION).call(y_axis);

      [
        ['pass-group', 'g', draw_passes],
        ['time-tick', 'line', draw_tick, false],
        ['line', 'path', draw_line, false]
      ].forEach(function(v) {
        var selection = detail_lines.selectAll('.detail.' + v[0]).data(visible_details.keys());
        // update existing lines
        selection.call(v[2], 1);
        // add new lines
        selection.enter().append(v[1]).call(v[2], 2);
        // remove old ones
        selection.exit().remove();
      })

      // hide the graph if it's empty
      var l = visible_details.keys().length;
      if (l == 0) {
        detail_elem.classList.add('hidden');
      } else {
        detail_elem.classList.remove('hidden');
      }

      // colour the markers and the text detail border
      visible_details.forEach(
        function (hash) {
          setColour(hash, hash_to_colour(hash));
        })

      function draw_line(selection) {
        selection
         .style('stroke', function(hash) { return hash_to_colour(hash); })
         .attr('id', function(hash) { return 'detail-line-' + hash; })
         .attr('class', 'line detail')
         .each(function(hash) {
            var hoverers = HoverEmphasisers(hash);
            this.addEventListener('mouseover', hoverers[0]);
            this.addEventListener('mouseout', hoverers[1]);
         })
         .datum(function(hash) { return detail_cache.get(hash).memory_data; })
         .attr('d', line);
      }
      function draw_tick(selection) {
        selection
         .filter(function(hash) { return detail_cache.get(hash).summary.cpu_time; })
         .style('stroke', function(hash) { return hash_to_colour(hash); })
         .attr('class', 'time-tick detail')
         .attr('x1', function(hash) { return x(detail_cache.get(hash).summary.cpu_time); })
         .attr('x2', function(hash) { return x(detail_cache.get(hash).summary.cpu_time); })
         .attr('y1', height - 20)
         .attr('y2', height);
      }
      function draw_passes(selection, which) {
        selection
         .each(
           function(hash) {
             var pass_timing = detail_cache.get(hash).pass_timing,
             position = 0,
             node = d3.select(this),
             check = document.getElementById('passes-check-' + hash),
             hidden = (check && check.checked) ? '' : 'hidden';

             node.attr('class', 'detail pass-group ' + hidden)
              .attr('id', 'pass-' + hash);

             var sel = node.selectAll('.pass-marker-group').data(pass_timing);
             sel.each(function(elem) {
               var time = elem[1];
               var that = d3.select(this);
               that.select('.pass-marker')
                   .attr('transform', 'translate(' + x(position) + ',0)');
               that.select('.pass-text-marker')
                   .attr('transform', 'translate(' + x(position + time / 2) + ',0)');
               position += time;
             });

             sel.enter()
               .append('g').attr('class', 'pass-marker-group')
               .each(function(elem) {
                 var pass = elem[0], time = elem[1];
                 var g = d3.select(this);
                 VerticalLine(g, x(position), '', {
                   'id': 'pass-' + pass.replace(' ', '-') + '-' + hash,
                   'class': 'pass-marker marker-' + hash,
                   'line-class': 'pass-line line-' + hash,
                   'dy': '0.4em'
                 });
                 VerticalLine(g, x(position + time / 2), pass, {
                   'id': 'pass-text-' + pass.replace(' ', '-') + '-' + hash,
                   'class': 'pass-text-marker marker-' + hash,
                   'text-class': 'pass',
                   'dy': '0.4em'
                 });
                 position += time;
               })
           })
      }
    }

    var toggle = function(hash, adjust_hash) {
      var remove = true;
      if (!visible_details.has(hash)) {
        remove = false;
      }

      if (detail_cache.has(hash)) {
        inner(detail_cache.get(hash), remove);
      } else {
        // set the colour here so it looks like something is happening
        setColour(hash, hash_to_colour(hash));
        d3.json("out/" + hash + ".json", function(e,d) {
          if (e) {
            console.warn("Error getting details", e);
            return;
          }

          detail_cache.set(hash, d);
          inner(d, remove)
        });
      }

      function inner(data, remove) {
        if (remove) {
          // already visible, so remove it
          setColour(hash, '');
          visible_details.remove(hash);
          clipped.select('.pass-marker-' + hash).remove();
          d3.select('#marker-' + hash).node().classList.remove('detail-visible');
          var text = document.getElementById('text-' + hash);
          text.parentNode.removeChild(text);
        } else {
          // not visible, so register it and it's description.
          var x_max = d3.max(data.memory_data, d_time),
              y_max = d3.max(data.memory_data, d_mem);
          visible_details.set(hash, {y: y_max, x: x_max});
          TextDetail(hash, data)
          d3.select('#marker-' + hash).node().classList.add('detail-visible');
        }

        // update the hash & plots for the above change.
        if (adjust_hash) {
          var new_hash = visible_details.keys().map(function(s) {return s.substr(0, 7)}).join(',');
          window.location.replace('#' + new_hash);
        }

        draw();
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
(
  function() {
    var x = d3.time.scale().range([0, width]),
        y_mem = d3.scale.linear().range([height, 0]),
        y_cpu_time = d3.scale.linear().range([height, 0]),
        x_axis = Axis(x, "bottom"),
        y_axis_mem = Axis(y_mem, "left"),
        y_axis_cpu_time = Axis(y_cpu_time, "right"),
        zmc = Plot(summary_elem, width, height, margin, x, draw, reset_zoom),
        zoom = zmc.zoom, main = zmc.main, clipped = zmc.clipped;

    DrawAxis(main, x_axis, '', 'x', {'translate-y': height});
    DrawAxis(main, y_axis_mem, 'Peak Memory (MiB)', 'y mem', {
      'rotate': '-90',
      'dy': '1.3em'
    });
    DrawAxis(main, y_axis_cpu_time, 'CPU Time (s)', 'y cpu', {
      'rotate': '-90',
      'translate-x': width,
      'dy': '-.9em'
    });

    function time(d) { return d.timestamp * 1000; }
    function mem(d) { return d.max_memory / (1024 * 1024); }
    function cpu_time(d) { return d.cpu_time; }

    var line_mem = Line(x, time, y_mem, mem);
    var line_cpu_time = Line(x, time, y_cpu_time, cpu_time);

    var data = [];
    var hash2data = d3.map();
    var lines = clipped.append('g');

    function draw() {
      // width of 1 hour is small
      main.node().classList[(x(3600*1000) - x(0)) < 2 ? 'add' : 'remove']('far-zoom')

      main.select('.x.axis').transition().duration(TRANSITION_DURATION / 2).call(x_axis);

      var x_lo = x.invert(0), x_hi = x.invert(width),
          y_cpu_max = AxisBounds(data, x_lo, x_hi, time, cpu_time)[1],
          y_mem_max = AxisBounds(data, x_lo, x_hi, time, mem)[1];

      y_cpu_time.domain([0, y_cpu_max * 1.01]).nice();
      y_mem.domain([0, y_mem_max * 1.01]).nice();

      main.select('.cpu.axis').transition().duration(TRANSITION_DURATION).call(y_axis_cpu_time);
      main.select('.mem.axis').transition().duration(TRANSITION_DURATION).call(y_axis_mem);

      var classes = ['cpu', 'mem'],
          class_lines = {cpu: line_cpu_time, mem: line_mem};

      var sel = clipped.selectAll('.line').data(classes);
      function draw_line(c) {
        // can't work out how to hold `c` over the datum call, since I
        // need it to work out which line.
        d3.select(this).datum(data).attr('d', class_lines[c]);
      };

      sel.each(draw_line)
      sel.enter().append('path')
         .attr('class', function(c) { return 'line ' + c; })
         .each(draw_line);

      sel = lines.selectAll('.commit-marker-group').data(data.concat([null]));
      sel.each(function(d) {
        // move the position of lines that already exist
        var t = d == null ? Date.now() : time(d);
        d3.select(this).select('.marker').attr('transform', 'translate(' + x(t) + ',0)');
      });
      // it's annoying that I have to add a layer of indirection here.
      sel.enter()
        .append('g').attr('class', 'commit-marker-group')
        .each(function(d) {
        var hash, t, lab, click;
        if (d === null) {
          hash = 'now'; t = Date.now(); lab = 'now';
          click = function() {}
        } else {
          hash = d.hash; t = time(d); lab = Label(d, false);
          click = function() {detail_toggle(d.hash, true)};
        }
        VerticalLine(d3.select(this), x(t), lab, {
          'id': 'marker-' + hash,
          'class': 'marker marker-' + hash,
          'line-class': 'marker-line line-' + hash,
          'text-class': 'hash',
          'click': click,
          'height': height,
          'dy': '0.3em'
        });
      });
    }
    function reset_zoom() {
      var min = d3.min(data, time),
          max = Date.now(),
          dt = max - min,
      // provide a buffer zone
          adjust = dt * 0.05;
      x.domain([min - adjust, max + adjust]);
      zoom.x(x);
      draw();
    }

    d3.json("out/summary.json", function(err, dat) {
      // only show the last 400 commits, because my code makes
      // browsers cry (and run slowly).
      if (PLOT_TRUNCATE === false) {
         data = dat;
      } else {
         data = dat.slice(-PLOT_TRUNCATE);
      }
      data.forEach(function(d) {
        hash2data.set(d.hash, d);
      });

      reset_zoom();

      // a map from the first 7 letters of each commit hash to the
      // whole thing, used for the URL #
      var short2long = d3.map();

      // draw the vertical lines for each commit
      data.forEach(function(d) {
        short2long.set(d.hash.substr(0, 7), d.hash);
      });

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
        reset_zoom();
      } else {
        // draw the last one
        detail_toggle(data[data.length - 1].hash, false)
      }
    })
})();
