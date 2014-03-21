use collections::PriorityQueue;

/// A helper struct for `visvalingam`, defined out here because
/// #[deriving] doesn't work in fns.
#[deriving(Ord, Eq)]
struct VScore {
    neg_area: f64,
    current: uint,
    left: uint,
    right: uint
}

/// Simplify a line using the Visvalingam algorithm.
pub fn visvalingam(xs: &[(f64, f64)], eps: f64) -> ~[(f64, f64)] {
    let max = xs.len();

    // the adjacent non-removed points. simulating the points in a
    // linked list with indices into `xs`. Big number (larger than
    // `max`) for no next element, and (0, 0) for deleted.
    let mut adjacent = Vec::from_fn(xs.len(), |i| {
        if i == 0 { (-1, 1) }
        else { (i - 1, i + 1) }
    });

    // stores all the triangles, with the ones with the smallest area
    // first. It *doesn't* get cleared of invalid ones if/when points
    // are removed, they are handled by just skipping them as
    // necessary in the main loop. (This is handled by recording the
    // state in the VScore.)
    let mut pq = PriorityQueue::new();

    // compute the initial triangles, i.e. take all consecutive groups
    // of 3 points and make that traingle.
    for (i, win) in xs.windows(3).enumerate() {
        let area = match win {
            [(a_x, a_y), (t_x, t_y), (b_x, b_y)] => {
                area(a_x, a_y, b_x, b_y, t_x, t_y)
            }
            _ => fail!("impossible!")
        };
        pq.push(VScore { neg_area: -area, current: i + 1, left: i, right: i + 2});
    }

    // While there are still points for which the associated triangle
    // has a small area
    while !pq.is_empty() && pq.top().neg_area > -eps {
        let smallest = pq.pop();
        let (left, right) = *adjacent.get(smallest.current);

        // A point in this triangle has been removed since this VScore
        // was created, so just skip it.
        if left != smallest.left || right != smallest.right {
            continue
        }

        // Now we've got a valid triangle, and its area is small, so
        // remove it from the "linked list"
        let (ll, _) = *adjacent.get(left);
        let (_, rr) = *adjacent.get(right);
        *adjacent.get_mut(left) = (ll, right);
        *adjacent.get_mut(right) = (left, rr);
        *adjacent.get_mut(smallest.current) = (0, 0);

        // Now recompute the triangles involving left and right
        let choices = [(ll, left, right), (left, right, rr)];
        for &(ai, ti, bi) in choices.iter() {
            if ai >= max || bi >= max { continue } // outta bounds, i.e. we're on one edge
            let (a_x, a_y) = xs[ai];
            let (t_x, t_y) = xs[ti];
            let (b_x, b_y) = xs[bi];
            let area = area(a_x, a_y, b_x, b_y, t_x, t_y);
            pq.push(VScore { neg_area: -area, current: ti, left: ai, right: bi});
        }
    }

    // filter out the points that have been deleted
    return xs.iter().zip(adjacent.iter()).filter_map(|(tup, adj)| {
        if *adj != (0, 0) {Some(*tup)} else {None}
    }).collect();

    // area of the triangle between the 3 points
    fn area(a_x: f64, a_y: f64,
            b_x: f64, b_y: f64,
            t_x: f64, t_y: f64) -> f64 {
        ((a_x - t_x) * (b_y- t_y) - (b_x - t_x) * (a_y - t_y)).abs()
    }
}

#[allow(dead_code)]
/// Simplify a line using the Ramer–Douglas–Peucker algorithm.
pub fn rdp(xs: &[(f64, f64)], eps: f64) -> ~[(f64, f64)] {
    return if xs.len() < 2 {
        xs.to_owned()
    } else {
        inner(xs, eps, true)
    };

    fn inner(xs: &[(f64, f64)], eps: f64, include_end: bool) -> ~[(f64, f64)] {
        let mut idx = 0;
        let mut d_max = 0.0;
        let (l_x, l_y, other_points, r_x, r_y) = match xs {
            [(a,b), .. o, (c,d)] => (a,b,o,c,d),
            _ => fail!("impossible!") // already filtered short lists
        };

        // calculate the point furthest from the line between the two
        // ends points.
        for (i, &(t_x, t_y)) in other_points.iter().enumerate() {
            let d = p_dist(l_x, l_y, r_x, r_y, t_x, t_y);
            if d > d_max {
                idx = i + 1; // account for slicing
                d_max = d;
            }
        }

        let mut ret = if d_max > eps {
            // recurse on either side of the point with the largest
            // deflection (assuming it's sufficiently far away).
            let mut r = inner(xs.slice(0, idx + 1), eps, false);
            r.push_all_move(inner(xs.slice(idx, xs.len()), eps, true));
            r
        } else {
            ~[xs[0], xs[xs.len() - 1]]
        };

        if !include_end { ret.pop(); }
        ret
    }

    // perpendicular distance from the point t to the line through a &
    // b.
    fn p_dist(a_x: f64, a_y: f64,
              b_x: f64, b_y: f64,
              t_x: f64, t_y: f64) -> f64 {
        let (dx, dy) = (b_x - a_x, b_y - a_y);

        let (a, b, c) = (dy, -dx, dx*a_y - dy*a_x);

        (a*t_x + b*t_y + c).abs() / (a*a + b*b).sqrt()
    }
}
