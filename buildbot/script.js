$(function() {
  var hashes = {}, has_hash = false;
  // allow hashes to be specified via #foo,bar,baz and they'll be
  // marked with a vertical line
  $.each(window.location.hash.replace(/^#/, '').split(','),
         function(i, val) {
           // space to avoid conflicts with built-in properties
           hashes[' ' + val.slice(0,7)] = true;
           has_hash = true;
         });

  var comp_series = [], test_series = [], markings = [];
  var  i = 0;
  $.each(
    PERF_DATA,
    function(plat, val) {
      comp_series.push({
        color: i,
        label: plat,
        data: val.compile
      });
      test_series.push({
        color: i,
        label: plat,
        data: val.test
      });

      i++;
    });

  if (has_hash) {
    var drawLines = function(data) {
      if (data == undefined) return;
      $.each(
        data['info'],
        function(i, val) {
          if (hashes[' ' + val.changeset.slice(0, 7)] === true) {
            var position = data.compile[i][0];
            markings.push({
              color: 'grey',
              lineWidth: 2,
              xaxis: {from: position, to: position}
            });
          }
        });
    };
    drawLines(PERF_DATA.linux); // old targets
    drawLines(PERF_DATA['linux-64-opt']); // new targets
  }

  var options = {
    series: {
      lines: {show: true},
      points: {show: true}
    },
    grid: {
      hoverable: true,
      clickable: true,
      markings: markings
    },
    xaxis: {mode: "time", min: Date.now() - 1000*3600*24*10, max: Date.now()},
    yaxis: {min: 0},
    legend: {position: "nw"}
  };
  var comp_box = $('#compile-plot-box');
  var comp_plot = $.plot(comp_box, comp_series, options);
  comp_box.bind('plotclick', plot_click);

  var test_box = $('#test-plot-box');
  var test_plot = $.plot(test_box, test_series, options);
  test_box.bind('plotclick', plot_click);


  function plot_click(event, pos, item) {
    target = event.currentTarget;
    if (item) {
      var plat = item.series.label;
      var series = PERF_DATA[plat];
      var info = series.info[item.dataIndex];
      var pr_num = info.pull_request;
      var changeset = info.changeset;
      var build_num = info.build_num;

      var time = series.compile[item.dataIndex][0];
      var comp = series.compile[item.dataIndex][1];
      var test = series.test[item.dataIndex][1];


      var pr = 'No pull request';
      if (pr_num !== null) {
        pr = '<a href="https://github.com/rust-lang/rust/pull/' + pr_num +
          '">Pull Request #' + pr_num + '</a>';
      }
      var c = 'Compile time: ' + comp + 's';
      var t = 'Test time: ' + test + 's';

      var b_url = 'http://buildbot.rust-lang.org/builders/auto-' + plat + '/builds/' + build_num;
      var b = 'Build: <a href="' + b_url + '"> ' + plat + ' ' + build_num + '</a>';
      var changeset_url = 'https://github.com/rust-lang/rust/commit/' + changeset;
      var cs = 'Merge commit: <a href="' + changeset_url + '">' + changeset.slice(0,7) + '</a>';
      var tt = new ToolTip(item.pageX, item.pageY, item, [pr, c, t, b, cs].join('<br>'));
      tt.drawFloating();
    }
  }
});
