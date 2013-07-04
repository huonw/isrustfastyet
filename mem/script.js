var width = 1000,
    height = 400,
    margin = {top: 20, right: 80, bottom: 30, left: 80};

var svg = d3.select("#summary").append("svg")
          .attr("width", width + margin.left + margin.right)
          .attr("height", height + margin.top + margin.bottom)
        .append("g")
          .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

var x = d3.time.scale()
    .range([0, width]);

var y_mem = d3.scale.linear()
    .range([height, 0]);
var y_cpu_time = d3.scale.linear()
    .range([height, 0]);

var xAxis = d3.svg.axis()
    .scale(x)
    .orient("bottom");

var yAxis_mem = d3.svg.axis()
    .scale(y_mem)
    .orient("left");
var yAxis_cpu_time = d3.svg.axis()
    .scale(y_cpu_time)
    .orient("right");

function time(d) { return d.timestamp * 1000; }
function mem(d) { return d.max_memory / (1024 * 1024); }
function cpu_time(d) { return d.cpu_time; }

var line_mem = d3.svg.line()
    .x(function(d) { return x(time(d)); })
    .y(function(d) { return y_mem(mem(d)); });
var line_cpu_time = d3.svg.line()
    .x(function(d) { return x(time(d)); })
    .y(function(d) { return y_cpu_time(cpu_time(d)); });

d3.json("out/summary.json", function(err, summary) {
  var x_range = d3.extent(summary, time),
      x_low = x_range[0], x_high = x_range[1],
      dx = x_high - x_low;

  x.domain([x_low - 0.03*dx, x_high + 0.03*dx]);
  var y_mem_max = d3.max(summary, mem);
  y_mem.domain([0, y_mem_max]);
  y_cpu_time.domain([0, d3.max(summary, cpu_time)]);

  svg.append("g")
      .attr("class", "x axis")
      .attr("transform", "translate(0," + height + ")")
      .call(xAxis);

  svg.append("g")
      .attr("class", "y axis mem")
      .call(yAxis_mem)
    .append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", 6)
      .attr("dy", ".71em")
      .style("text-anchor", "end")
      .text("Memory (MiB)");
  svg.append("g")
      .attr("class", "y axis cpu")
      .attr("transform", "translate(" + width + ",0)")
      .call(yAxis_cpu_time)
     .append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", 1)
      .attr("dy", "-.9em")
      .style("text-anchor", "end")
      .text("CPU Time (s)");

  // vertical lines go under the graphs
  var lines = svg.append('g');

  svg.append("path")
      .datum(summary)
      .attr("class", "line mem")
      .attr("d", line_mem);
  svg.append("path")
      .datum(summary)
      .attr("class", "line cpu")
      .attr("d", line_cpu_time);

  summary.forEach(function(d) {
    var xx = x(time(d));
    var g = lines.append('g')
       .attr("transform", "translate(" + xx +", 0)")
       .attr('class', 'marker')
       .on('click', function (a,b,c,d) {
           console.log(a,b,c,d)
        });
    g.append('line')
       .attr('class', 'marker-line')
       .attr('x1', 0).attr('x2', 0)
       .attr('y1', height).attr('y2', 0);

    g.append('text')
      .attr("class", "hash")
      .attr("transform", "rotate(-90)")
      .attr('x', -height + 100)
      .attr("dy", "0.3em")
      .style("text-anchor", "end")
      .text(d.hash.substr(0, 6));
  })
})
