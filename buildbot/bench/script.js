function run(changesets, names, plats) {
  var plot = new CommitPlot('plot', 1100, 600, changesets,
                            function(xy) { return xy[0] },
                            function(xy) { return xy[1] });
  plot.draw();

  var platform = 'linux-64-opt';

  var tree = document.getElementById('bench-tree');
  var legend = document.getElementById('legend');
  var bench_cache = d3.map();

  for (var i = 0; i < names.length; i++) {
    var name = names[i],
        dom_name = name.replace(/::/g, '-'),
        parts = name.split('::'),
        last = parts.pop();

    var accum = 'bench-tree-list';
    var prev = document.getElementById(accum);
    for (var j = 0; j < parts.length; j++) {
      accum += '-' + parts[j];
      var elem = document.getElementById(accum);

      if (!elem) {
        var label = document.createElement('span');

        label.innerHTML = parts[j];
        label.classList.add('bench-module-title');
        label.classList.add('collapsed');

        elem = document.createElement('ul');
        elem.id = accum;
        elem.classList.add('bench-module');
        elem.classList.add('collapsed');

        (function(label, elem) {
          label.onclick = function() {
            label.classList.toggle('collapsed');
            elem.classList.toggle('collapsed');
          };
        })(label,elem)

        var li = document.createElement('li');
        li.appendChild(label)
        li.appendChild(elem);
        prev.appendChild(li);
      }
      prev = elem;
    }

    var text = document.createElement('li');
    text.id = accum + '-' + last;
    text.classList.add('bench-function');
    text.classList.add(dom_name);
    text.innerHTML = last;
    text.onclick = make_text_clicker(text, dom_name, name, parts, last);
    prev.appendChild(text);
  }

  read_from_target();


  function make_text_clicker(text, dom_name, name, parts, last) {

    var id = 0;
    return function() {
      id++;
      var my_id = id;

      if (text.classList.contains('active')) {
        remove_series(text, name, dom_name)
      } else {
        text.classList.add('active');
        set_hover(text, dom_name);

        var value = bench_cache.get(name);
        if (!value) {
          var filename = platform + '/' + parts[0] + '/' + parts[1] + '.json';
          d3.json(filename, function(data) {
            build_cache(parts[0], parts[1], data);
            var value = bench_cache.get(name);
            draw(text, name, dom_name, value)
          });
        } else {
          draw(text, name, dom_name, value)
        }
      }
    }
  }

  function build_cache(crate, module, data) {
    var prefix = crate + '::' + module + '::'
    for (var k in data) {
      if (data.hasOwnProperty(k)) {
        bench_cache.set(prefix + k, data[k]);
      }
    }
  }

  function draw(text, name, dom_name, value) {
    plot.add(dom_name, value);
    plot.draw();
    toggle_legend(text, name, dom_name, true);
    update_target();
  }

  function remove_series(text, name, dom_name) {
    text.classList.remove('active')
    text.classList.remove('hover');
    clear_hover(text);
    plot.remove(dom_name);
    plot.draw();
    toggle_legend(text, name, dom_name, false);
    update_target();
  }

  function toggle_legend(text, name, dom_name, insert) {
    var id = 'legend-' + dom_name;
    var entry = document.getElementById(id);
    if (!insert) {
      if (entry) {
        entry.parentNode.removeChild(entry);
      }
    } else {
      if (entry) { return; }

      entry = document.createElement('li');
      entry.textContent = name;
      entry.style.color = hash_to_colour(dom_name);
      entry.id = id;
      entry.classList.add(dom_name);
      entry.onclick = function() { remove_series(text, name, dom_name); }

      var siblings = legend.childNodes;
      var i = 0, l = siblings.length;
      for (; i < l; i++) {
        console.log(siblings[i].textContent);
        if (name < siblings[i].textContent) break;
      }

      legend.insertBefore(entry, siblings[i]);

      set_hover(entry, dom_name);
    }
  }

  function update_target() {
    var benches =
      Array.prototype.map.call(legend.childNodes, function(n) {
        return n.id.replace(/^legend-/, '')
      });
    window.location.replace('#benches=' + benches.join(','))
  }

  function read_from_target() {
    var parts = window.location.hash.substr(1).split(';');
    var benches = [];
    console.log('reading from target...', parts)
    parts.forEach(function (x) {
      var inner = /([^=]*)=(.*)/.exec(x);
      if (!inner) { return }

      switch (inner[1]) {
        case 'benches': benches = inner[2].split(','); break
        default: console.warn('unrecognised param ' + inner[1])
      }
    })

    if (benches.length) {
      var files = d3.set();
      benches.forEach(function(name) {
        var parts = name.split('-', 2),
            crate = parts[0],
            module = parts[1];
        files.add(crate + ' ' + module);
      })
      files = files.values();

      var f = function() {
        if (files.length) {
          var crate_module = files.pop().split(' '),
              crate = crate_module[0], module = crate_module[1];
          console.log('loading', crate, module);
          d3.json(platform + '/' + crate + '/' + module + '.json',
                  function(d) { build_cache(crate, module, d); f() })
        } else {
          // all loaded
          benches.forEach(function(dom_name) {
            var name = dom_name.replace(/-/g, '::');
            var elem = document.getElementById('bench-tree-list-' + dom_name),
                data = bench_cache.get(name);
            if (!elem || !data) { console.warn('Unknown bench: ' + dom_name); return }

            draw(elem, name, dom_name, data);
          })
        }
      };

      f()
    }
  }

  function clear_hover(elem) {
    elem.onmouseover = elem.onmouseout = null;
  }

  function set_hover(elem, dom_name) {
    var ids = ['legend-' + dom_name,  'bench-tree-list-' + dom_name, 'plot-line-' + dom_name];

    elem.onmouseover = function() {
      Array.prototype.forEach.call(document.getElementsByClassName(dom_name),
                                   function(e) { e.classList.add('hover'); });
    }
    elem.onmouseout = function() {
      Array.prototype.forEach.call(document.getElementsByClassName(dom_name),
                                   function(e) { e.classList.remove('hover'); });
    }
  }
}


d3.json('changesets.json', function(changesets) {
  d3.json('bench_names.json', function(names) {
    d3.json('platforms.json', function(plats) {
      run(changesets, names, plats)
    })
  })
})