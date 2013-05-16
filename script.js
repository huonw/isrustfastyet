$(function() {
  var comp_series = [], test_series = [];
  var  i = 0;
  $.each(
    PERF_DATA,
    function(plat, val) {
      comp_series.push({
        color: i,
        label: plat,
        data: val['compile']
      });
      test_series.push({
        color: i,
        label: plat,
        data: val['test']
      });

      i++;
    });

  var options = {
    series: {
      lines: {show: true},
      points: {show: true}
    },
    grid: {
      hoverable: true,
      clickable: true
    },
    xaxis: {mode: "time"},
    yaxis: {min: 0}
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

      var pr = '<a href="https://github.com/mozilla/rust/pull/' + pr_num + '">Pull Request #' + pr_num + '</a>';
      var c = 'Compile time: ' + comp + 's';
      var t = 'Test time: ' + test + 's';

      var b_url = 'http://buildbot.rust-lang.org/builders/auto-' + plat + '/builds/' + build_num;
      var b = 'Build: <a href="' + b_url + '"> ' + plat + ' ' + build_num + '</a>';
      var tt = new ToolTip(item.pageX, item.pageY, item, pr + '<br>' + c + '<br>' + t + '<br>' + b);
      tt.drawFloating();
    }
  }
});
