function djb2(str){
  var hash = 5381;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
  }
  return hash;
}

function hash_to_colour(str) {
  var hash = djb2(str);
  var r = (hash & 0x7f0000) >> 16 + 64,
      g = (hash & 0x007f00) >> 8 + 64,
      b = (hash & 0x00007F) + 64;
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function CommitPlot(id,
                    width, height,
                    commits,
                    x_selector, y_selector,
                    tooltip_html) {
  var elem = d3.select(document.getElementById(id));

  var svg_raw = elem.append('svg').attr('width', width + 100)
                .attr('height', height + 50);
  var svg = svg_raw.append('g').attr('transform', 'translate(100, 0)');

  var x_min_max = d3.extent(d3.values(commits), function(c) { return c.time; });

  var x_scale = d3.time.scale().range([0, width]).domain(x_min_max).nice(),
      y_scale = d3.scale.linear().range([height, 0]).domain([0, 1]).nice();

  var x_axis = d3.svg.axis().scale(x_scale).orient('bottom'),
      y_axis = d3.svg.axis().scale(y_scale).orient('left');

  svg.append('defs')
  .append('clipPath')
    .attr('id', 'clip')
    .append('rect').attr('x', 0).attr('y', 0).attr('width', width).attr('height', height);

  var lines = svg.append('g').attr('clip-path', 'url(#clip)');


  var x_axis_elem = svg.append('svg:g').attr('class', 'axis x')
                    .attr('transform', 'translate(0,' + height +')');
  var y_axis_elem = svg.append('svg:g').attr('class', 'axis y');

  var zoomer = d3.behavior.zoom().x(x_scale)
             .on('zoom', function() {
               d3.event.sourceEvent.stopPropagation();
               d3.event.sourceEvent.preventDefault();
               zoom();
             });
  svg_raw.call(zoomer);

  var line = d3.svg.line()
             .x(function(xy) { return x_scale(xy[0]); })
             .y(function(xy) { return y_scale(xy[1]); });

  var data = d3.map(), y_maxes = d3.map();

  this.add = function(label, dat) {
    var col = hash_to_colour(label);
    console.log(col);
    dat = dat.map(function(d) { return [commits[x_selector(d)].time,
                                        y_selector(d)]; });

    var extents = d3.max(dat, function(xy) { return xy[1]; });
    data.set(label, {label: label, colour: col, data: dat});
    y_maxes.set(label, extents);
  }

  this.remove = function(label) {
    data.remove(label);
    y_maxes.remove(label);
  }

  this.draw = function() {
    console.log('drawing...');
    y_scale.domain([0, d3.max(y_maxes.values())]);

    y_axis_elem.call(y_axis);
    x_axis_elem.call(x_axis);
    var sel = lines.selectAll('.line').data(data.values(), function(d) { return d.label; });

    sel.enter().append('path')
    .style('stroke', function(d) { return d.colour; })
    .attr('class', function(d) { return 'line ' + d.label; })
    .datum(function(x) { return x.data })
    .attr('d', line);

    sel.exit().remove();
  }

  function zoom() {
    lines.selectAll('.line').attr('d', line);
    svg.select('.axis.x').call(x_axis);
  }
}