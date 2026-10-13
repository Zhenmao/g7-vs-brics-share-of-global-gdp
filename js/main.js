d3.csv("data/data.csv", d3.autoType).then((data) => {
  ///////////////////////////////////////////////////////////
  //// Process Data /////////////////////////////////////////
  ///////////////////////////////////////////////////////////

  const weightAccessor = (d) => +d["GDP 2026 Estimate (USD Billions)"];
  const nameAccessor = (d) => d["Country"];

  const iconAccessor = (d) => (d["Code"] ? `images/${d["Code"]}.svg` : null);

  const root = d3.hierarchy(
    d3.group(
      data,
      (d) => d["Group"],
      (d) => d["Sub-Group"],
    ),
  );

  root.sum(weightAccessor);

  ///////////////////////////////////////////////////////////
  //// Setup ////////////////////////////////////////////////
  ///////////////////////////////////////////////////////////

  // Each group (G7, BRICS, RoW) is a proportionally sized diamond shape offset from the center of the canvas. Then each diamond is divided into proportionally sized cells with voronoiTreemap. The whole visualization is computed as a standard four-quadrant layout with the container rotated counterclockwise 45 degrees.

  let isNarrow;
  const narrowThreshold = 800;

  // Make voronoiTreemap layout reproducible
  const seed = 42;
  const random = d3.randomLcg(seed);

  const maxGroupWidth = 400;
  const groupGap = 32;

  const colorScale = d3
    .scaleOrdinal()
    .domain(["G7", "BRICS", "BRICS Partners", "Rest of World"])
    .range([
      "var(--color-g7)",
      "var(--color-brics)",
      "var(--color-brics-partner)",
      "var(--color-row)",
    ]);

  // Rounded corners polygons
  // https://github.com/BrunoFenzl/svg-round-corners
  const cornerRadius = 6;
  const line = d3.line().curve(d3.curveLinearClosed);
  const roundedCornersPath = (points) =>
    svgRoundCorners.roundCorners(line(points), cornerRadius).path;

  // Sub-group labels
  const labelPadding = 6;
  const labelHeightRatio = 0.6; // actual ink height to getBBox height ratio
  let smallLabelHeight, largeLabelHeight, labelGroupHeight;
  const isLabelOnTop = (d) => ["G7", "BRICS"].includes(d.data[0]);

  // Cell labels
  const iconThresholdValue = 500;
  const valueThresholdValue = 2000;
  const largeIconSize = 32; // With value label
  const smallIconSize = 24; // Without value label
  const formatValue = (d) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
    }).format(d * 1e9);

  const formatShare = new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format;

  ///////////////////////////////////////////////////////////
  //// Layout ///////////////////////////////////////////////
  ///////////////////////////////////////////////////////////

  const xScale = d3
    .scaleSqrt()
    .domain([0, d3.max(root.children, (d) => d.value)])
    .range([0, maxGroupWidth]);

  layoutVoronoiTreemap();

  function layoutVoronoiTreemap() {
    root.children.forEach((group) => {
      // Each group has its voronoiTreemap anchored at the origin
      const width = xScale(group.value);
      const height = width;
      const voronoiTreemap = d3
        .voronoiTreemap()
        .clip([
          [0, 0],
          [0, height],
          [width, height],
          [width, 0],
        ])
        .prng(random);
      voronoiTreemap(group);
    });
  }

  function layoutQuadrants() {
    root.children.forEach((group) => {
      const width = xScale(group.value);
      const height = width;

      // Each group is then transformed to its quadrant
      switch (group.data[0]) {
        case "BRICS":
          // 1st quadrant
          group.translateX = groupGap / 2;
          group.translateY = -groupGap / 2 - height;
          break;
        case "G7":
          // wide: 3rd quadrant; narrow 2nd quadrant
          group.translateX = -groupGap / 2 - width;
          group.translateY = isNarrow ? -groupGap / 2 - height : groupGap / 2;
          break;
        case "Rest of World":
          // 4th quadrant
          group.translateX = groupGap / 2;
          group.translateY = groupGap / 2;
          break;
        default:
          break;
      }
    });
  }

  ///////////////////////////////////////////////////////////
  //// Render ///////////////////////////////////////////////
  ///////////////////////////////////////////////////////////
  const container = d3.select("#chart").classed("chart", true);

  const tooltip = initTooltip(container);

  const svg = container.append("svg");
  const g = svg.append("g").attr("transform", "rotate(45)");

  const groupG = g
    .selectChildren(".group")
    .data(root.children)
    .join("g")
    .attr("class", "group");

  const cellG = groupG
    .selectChildren(".cell")
    .data((d) => d.leaves())
    .join("g")
    .attr("class", "cell");

  cellG
    .append("path")
    .attr("class", "cell__polygon")
    .attr("d", (d) => roundedCornersPath(d.polygon))
    .attr("fill", (d) => colorScale(d.parent.data[0]))
    .on("mouseenter", (event, d) => {
      tooltip.show(tooltipContent(d), colorScale(d.parent.data[0]));
      tooltip.move(event);
    })
    .on("mousemove", tooltip.move)
    .on("mouseleave", tooltip.hide);

  const cellLabel = cellG
    .filter((d) => {
      if (!iconAccessor(d.data)) return false; // Remove RoW
      return d.value >= iconThresholdValue; // Remove small polygons
    })
    .append("g")
    .attr("class", "cell__label")
    .attr(
      "transform",
      (d) => `translate(${d.polygon.site.x},${d.polygon.site.y}) rotate(-45)`,
    )
    .each(function (d, i, n) {
      const hasValueLabel = d.value >= valueThresholdValue;
      const iconSize = hasValueLabel ? largeIconSize : smallIconSize;
      const g = d3.select(n[i]);
      g.append("image")
        .attr("href", (d) => iconAccessor(d.data))
        .attr("x", -iconSize / 2)
        .attr("y", -iconSize / 2 - (hasValueLabel ? 3 : 0))
        .attr("width", iconSize)
        .attr("height", iconSize);

      if (hasValueLabel) {
        g.append("text")
          .attr("text-anchor", "middle")
          .attr("dy", "0.71em")
          .attr("y", iconSize / 2 + 3)
          .text((d) => formatValue(d.value));
      }
    });

  const subGroupG = groupG
    .selectChildren(".sub-group")
    .data((d) => d.children)
    .join("g")
    .attr("class", "sub-group");

  subGroupG
    .append("path")
    .attr("class", "sub-group__polygon")
    .attr("d", (d) => roundedCornersPath(d.polygon));

  const subGroupLabelG = subGroupG
    .append("g")
    .attr("class", "sub-group__label")
    .attr("fill", (d) => colorScale(d.data[0]))
    .attr("text-anchor", (d) => (isLabelOnTop(d) ? "start" : "end"));

  subGroupLabelG
    .append("text")
    .attr("class", "sub-group__label__value")
    .text((d) => formatValue(d.value))
    .each(function () {
      if (smallLabelHeight) return;
      smallLabelHeight = this.getBBox().height * labelHeightRatio;
    });

  subGroupLabelG
    .append("text")
    .attr("class", "sub-group__label__name")
    .text((d) => d.data[0])
    .attr("y", -smallLabelHeight - labelPadding);

  subGroupLabelG
    .append("text")
    .attr("class", "sub-group__label__share")
    .text((d) => formatShare(d.value / root.value))
    .each(function () {
      if (largeLabelHeight) return;
      largeLabelHeight = this.getBBox().height * labelHeightRatio;
      labelGroupHeight =
        smallLabelHeight * 2 + largeLabelHeight + labelPadding * 2;
    })
    .attr("y", -smallLabelHeight * 2 - labelPadding * 2);
  function rerender() {
    groupG.attr(
      "transform",
      (d) => `translate(${d.translateX},${d.translateY})`,
    );

    subGroupLabelG.attr("transform", (d) => {
      const isOnTop = isLabelOnTop(d);

      if (isNarrow)
        return isOnTop
          ? `translate(0,${-labelPadding})`
          : `rotate(-90)translate(0,${xScale(d.parent.value) + labelGroupHeight + labelPadding})`;

      return isOnTop
        ? `rotate(-90)translate(-${xScale(d.parent.value)},${-labelPadding})`
        : `rotate(-90)translate(0,${xScale(d.parent.value) + labelGroupHeight + labelPadding})`;
    });
  }

  ///////////////////////////////////////////////////////////
  //// Size SVG /////////////////////////////////////////////
  ///////////////////////////////////////////////////////////

  function sizeSVG() {
    const groupBounds = groupG.nodes().map((node) => {
      let { x, y, width, height } = node.getBBox();
      const { translateX, translateY } = d3.select(node).datum();
      x += translateX;
      y += translateY;
      return [
        [x, y],
        [width + x, y],
        [x, height + y],
        [width + x, height + y],
      ];
    });
    const rotatedGroupBounds = groupBounds.map((bound) => bound.map(rotate45));
    const viewBox = computeViewBox(rotatedGroupBounds);
    svg
      .attr("width", viewBox[2])
      .attr("height", viewBox[3])
      .attr("viewBox", viewBox);
  }

  function rotate45([x, y]) {
    const angle = (45 * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const newX = x * cos - y * sin;
    const newY = x * sin + y * cos;
    return [newX, newY];
  }

  function computeViewBox(bounds) {
    const [x1, x2] = d3.extent(
      bounds.flatMap((bound) => bound.flatMap((d) => d[0])),
    );
    const [y1, y2] = d3.extent(
      bounds.flatMap((bound) => bound.flatMap((d) => d[1])),
    );
    const x = Math.floor(x1);
    const y = Math.floor(y1);
    const width = Math.ceil(x2) - x;
    const height = Math.ceil(y2) - y;
    return [x, y, width, height];
  }

  ///////////////////////////////////////////////////////////
  //// Resize ///////////////////////////////////////////////
  ///////////////////////////////////////////////////////////

  new ResizeObserver(resized).observe(container.node());

  function resized() {
    tooltip.hide();

    const newIsNarrow = container.node().clientWidth < narrowThreshold;
    if (isNarrow !== undefined && isNarrow === newIsNarrow) return;
    isNarrow = newIsNarrow;

    layoutQuadrants();
    rerender();
    sizeSVG();
  }

  ///////////////////////////////////////////////////////////
  //// Tooltip //////////////////////////////////////////////
  ///////////////////////////////////////////////////////////

  function tooltipContent(d) {
    return /*html*/ `
    <div class="tooltip__content">
      <div class="tooltip__title">${nameAccessor(d.data)}</div>
      <div class="tooltip__subtitle">${d.parent.data[0]}</div>
      <div class="tooltip__value">${formatValue(weightAccessor(d.data))}<div>
    </div>
    `;
  }
  function initTooltip(container) {
    let tRect, bRect;
    const yOffset = 12;

    const tooltip = container.append("div").attr("class", "tooltip");

    function show(content, color) {
      tooltip
        .html(content)
        .style("border-color", color)
        .classed("is-visible", true);
      tRect = tooltip.node().getBoundingClientRect();
      bRect = container.node().getBoundingClientRect();
    }

    function move(event) {
      const [mx, my] = d3.pointer(event, container.node());
      let x = mx - tRect.width / 2;
      if (x < 0) {
        x = 0;
      } else if (x + tRect.width > bRect.width) {
        x = bRect.width - tRect.width;
      }

      let y = my - tRect.height - yOffset;
      if (y < 0) {
        y = my + yOffset;
        if (y + tRect.height > bRect.height) {
          y = bRect.height - tRect.height;
        }
      }

      tooltip.style("transform", `translate(${x}px,${y}px)`);
    }

    function hide() {
      tooltip.classed("is-visible", false);
    }

    return {
      show,
      move,
      hide,
    };
  }
});
