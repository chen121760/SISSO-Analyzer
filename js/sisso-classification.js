/* SISSO ptype=2: official overlap rankings and descriptor projections. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./sisso-core.js"));
  else root.SissoClassification = factory(root.SissoCore);
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  function isClassification(files) {
    var settings = files.sissoin || files.sissoInText || "";
    return Core.parseSissoIn(settings).ptype === 2 ||
      /#data_overlap/i.test(files.top || files.topText || "");
  }

  function number(text) {
    return Number(String(text).replace(/[dD]/, "e"));
  }

  function parseSettings(text) {
    var values = Object.create(null);
    Core.sissoInEntries(text).forEach(function (e) { values[e.key] = e.value; });
    var info = Core.parseSissoIn(text);
    if (info.ptype !== 2) throw new Error("Classification requires SISSO.in with ptype=2.");
    if (info.ntask !== null && info.ntask !== 1) throw new Error("Classification currently supports ntask=1.");
    if (info.descDim !== 1 && info.descDim !== 2) throw new Error("Classification currently supports 1D and 2D descriptors.");
    if (!/^\(\s*\d+(?:\s*,\s*\d+)+\s*\)$/.test(values.nsample || "")) {
      throw new Error("Classification requires nsample=(n_class1,n_class2,...) in SISSO.in.");
    }
    var counts = values.nsample.match(/\d+/g).map(Number);
    if (counts.some(function (n) { return !Number.isSafeInteger(n) || n <= 0; })) {
      throw new Error("Each classification category must have a positive integer sample count.");
    }
    var convex = counts.map(function () { return 1; });
    if (values.isconvex !== undefined) {
      if (!/^\(\s*[01](?:\s*,\s*[01])+\s*\)$/.test(values.isconvex)) throw new Error("Invalid isconvex category flags.");
      convex = values.isconvex.match(/[01]/g).map(Number);
      if (convex.length !== counts.length) throw new Error("isconvex must have one flag per category.");
    }
    var bwidth = values.bwidth === undefined ? null : number(values.bwidth);
    if (bwidth !== null && (!Number.isFinite(bwidth) || bwidth < 0)) throw new Error("Invalid bwidth in SISSO.in.");
    return Object.assign(info, { ntask: 1, classCounts: counts, isconvex: convex, bwidth: bwidth });
  }

  function parseTop(text, dim) {
    var lines = String(text || "").trim().split(/\r?\n/);
    if (!/rank\s+#data_overlap\s+size_overlap\s+feature_ID/i.test(lines[0])) {
      throw new Error("Expected classification top file: rank #data_overlap size_overlap feature_ID.");
    }
    var ranks = new Set();
    var models = lines.slice(1).filter(function (s) { return s.trim(); }).map(function (line, i) {
      var m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+\(\s*([\d\s]+)\s*\)\s*$/);
      if (!m) throw new Error("Invalid classification model row " + (i + 2) + ".");
      var rank = Number(m[1]), overlap = Number(m[2]), size = number(m[3]);
      var ids = m[4].trim().split(/\s+/).map(Number);
      if (!Number.isSafeInteger(rank) || rank < 1 || ranks.has(rank) ||
          !Number.isSafeInteger(overlap) || !Number.isFinite(size) || ids.length !== dim ||
          new Set(ids).size !== ids.length || ids.some(function (id) { return !Number.isSafeInteger(id) || id < 1; })) {
        throw new Error("Invalid rank, score or descriptor IDs in classification model row " + (i + 2) + ".");
      }
      ranks.add(rank);
      return { rank: rank, dataOverlap: overlap, sizeOverlap: size, featureIds: ids };
    });
    if (!models.length) throw new Error("No classification models found.");
    models.sort(function (a, b) { return a.rank - b.rank; });
    return models;
  }

  function parseData(text, nameMap, label) {
    var header = Core.readHeaderNames(text);
    if (header.length !== nameMap.length || header.some(function (s, i) { return s !== nameMap[i].original_name; })) {
      throw new Error(label + " columns must match train.dat in the same order.");
    }
    var normalized = String(text).trim().split(/\r?\n/).map(function (line, i) {
      if (!i) return line;
      var cells = line.trim().split(/\s+/);
      for (var c = 1; c < cells.length; c++) {
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?$/.test(cells[c])) {
          throw new Error(label + " has an invalid numeric value at row " + i + ", column " + (c + 1) + ".");
        }
        cells[c] = cells[c].replace(/[dD]/, "e");
      }
      return cells.join(" ");
    }).join("\n");
    var data = Core.parseDataFile(normalized, nameMap);
    data.featureLetters = nameMap.slice(1).map(function (n) { return n.new_name; });
    if (!data.n) throw new Error(label + " contains no samples.");
    if (new Set(data.names).size !== data.n) throw new Error(label + " contains duplicate sample IDs.");
    data.featureLetters.forEach(function (letter) {
      if (Array.from(data.cols[letter]).some(function (v) { return !Number.isFinite(v); })) {
        throw new Error(label + " contains non-finite feature values.");
      }
    });
    return data;
  }

  function labelsFromJson(text, data, nClasses, expected, classOrder) {
    if (!text) return null;
    var doc;
    try { doc = JSON.parse(text); } catch (e) { throw new Error("Invalid classification labels JSON."); }
    if (!Array.isArray(doc.rows) || doc.rows.length !== data.n || !Array.isArray(doc.class_order) ||
        doc.class_order.length !== nClasses || doc.class_order.some(function (s) { return typeof s !== "string" || !s; }) ||
        new Set(doc.class_order).size !== nClasses) {
      throw new Error("Labels require class_order and one row per sample.");
    }
    if (classOrder && doc.class_order.some(function (s, i) { return s !== classOrder[i]; })) {
      throw new Error("Training and verification class_order must agree.");
    }
    var byId = new Map();
    doc.rows.forEach(function (row) {
      if (!row || typeof row.id !== "string" || byId.has(row.id) ||
          !(row.class === null && !expected || Number.isInteger(row.class) && row.class >= 0 && row.class < nClasses)) {
        throw new Error("Invalid or duplicate ID/class in labels JSON.");
      }
      byId.set(row.id, row);
    });
    data.labels = data.names.map(function (name, i) {
      var row = byId.get(name);
      if (!row || (expected && row.class !== expected[i])) throw new Error("Label ID or class block mismatch for " + name + ".");
      return row.class;
    });
    return doc.class_order;
  }

  function projectModel(result, model, dataset) {
    var data = dataset === "verify" ? result.verify : result.train;
    if (!data) throw new Error("Dataset is not available.");
    var features = Object.create(null);
    data.featureLetters.forEach(function (s) { features[s] = true; });
    var functions = model.descriptors.map(function (d) { return Core.compileFormula(d.renamed); });
    return data.names.map(function (name, i) {
      var getter = Core.makeFeatureGetter(data.cols, features, i);
      var coords = functions.map(function (fn) { return fn(getter); });
      return { name: name, index: i + 1, coords: coords,
        classIndex: data.labels ? data.labels[i] : null,
        finite: coords.every(Number.isFinite),
        classified: dataset === "train" && model.official ? model.official[i].classified : null };
    });
  }

  function hasVerificationLabels(result) {
    return !!(result.verify && Array.isArray(result.verify.labels) && result.verify.labels.length === result.verify.n &&
      Array.from(result.verify.labels).every(function (c) { return Number.isInteger(c) && c >= 0 && c < result.classes.length; }));
  }

  function labelsFromCounts(text, nClasses, nSamples) {
    var value = String(text).trim().replace(/^nsample\s*=\s*/i, "");
    if (/^\(.*\)$/.test(value)) value = value.slice(1, -1).trim();
    if (!/^\d+(?:\s*,\s*\d+)*$/.test(value)) throw new Error("verificationCountsFormat");
    var counts = value.split(",").map(Number);
    if (counts.length !== nClasses || counts.some(function (n) { return !Number.isSafeInteger(n); })) {
      throw new Error("verificationCountsFormat");
    }
    var total = counts.reduce(function (a, b) { return a + b; }, 0);
    if (total !== nSamples) {
      var error = new Error("verificationCountsTotal"); error.total = total; throw error;
    }
    var labels = [];
    counts.forEach(function (n, c) { for (var i = 0; i < n; i++) labels.push(c); });
    return labels;
  }

  function verificationLabelText(result, labels) {
    if (!result.verify || !Array.isArray(labels) || labels.length !== result.verify.n || Array.from(labels).some(function (c) {
      return c !== null && !(Number.isInteger(c) && c >= 0 && c < result.classes.length);
    })) throw new Error("Invalid verification classes.");
    return JSON.stringify({ class_order: result.classes, rows: result.verify.names.map(function (id, i) {
      return { id: id, class: labels[i] };
    }) });
  }

  function parseOfficial(text, points, dim) {
    var lines = String(text).trim().split(/\r?\n/);
    if (!/index\s+classified\?/i.test(lines.shift() || "")) throw new Error("Invalid top1 descriptor file header.");
    var rows = lines.filter(function (s) { return s.trim(); }).map(function (line, i) {
      var p = line.trim().split(/\s+/);
      var coords = p.slice(2).map(number);
      if (p.length !== dim + 2 || Number(p[0]) !== i + 1 || !/^(YES|NO)$/.test(p[1]) ||
          coords.some(function (v, j) { return !Number.isFinite(v) || !points[i] || !points[i].finite ||
            Math.abs(v - points[i].coords[j]) > 1e-8 * Math.max(1, Math.abs(v), Math.abs(points[i].coords[j])); })) {
        throw new Error("Official top1 descriptor coordinates do not match the selected model/train.dat at row " + (i + 1) + ".");
      }
      return { classified: p[1], coords: coords };
    });
    if (rows.length !== points.length) throw new Error("Official top1 descriptor row count differs from train.dat.");
    return rows;
  }

  function parseHulls(text, info, official) {
    var classCounts = info.classCounts;
    var hulls = new Array(classCounts.length), current = null, classPoints = [];
    String(text).split(/\r?\n/).forEach(function (line) {
      if (!line.trim() || /^The coordinates/i.test(line.trim())) return;
      var m = line.match(/^\s*Hull\s+(\d+)\s*$/i);
      if (m) {
        var index = Number(m[1]) - 1;
        if (index < 0 || index >= classCounts.length || hulls[index] || !info.isconvex[index]) throw new Error("Invalid category in convex2D_hull.");
        var start = classCounts.slice(0, index).reduce(function (a, b) { return a + b; }, 0);
        classPoints = official.slice(start, start + classCounts[index]);
        current = []; hulls[index] = current; return;
      }
      var coords = line.trim().split(/\s+/).map(number);
      if (!current || coords.length !== 2 || coords.some(function (v) { return !Number.isFinite(v); }) ||
          !classPoints.some(function (p) { return p.coords.every(function (v, i) {
            return Math.abs(v - coords[i]) <= 1e-8 * Math.max(1, Math.abs(v));
          }); })) throw new Error("convex2D_hull does not match official top1 coordinates.");
      current.push(coords);
    });
    if (hulls.filter(Boolean).length !== info.isconvex.filter(Boolean).length || hulls.some(function (h) { return !h.length; })) throw new Error("convex2D_hull category count mismatch.");
    return hulls;
  }

  function runPipeline(files) {
    ["train", "top", "uspace", "sissoin"].forEach(function (key) {
      if (typeof files[key] !== "string" || !files[key].trim()) throw new Error("Missing classification file: " + key + ".");
    });
    var info = parseSettings(files.sissoin);
    var header = Core.readHeaderNames(files.train);
    if (header.length < 2 || new Set(header).size !== header.length) throw new Error("Classification requires name + unique feature columns.");
    if (info.nsf !== null && info.nsf !== header.length - 1) throw new Error("nsf differs from name + features layout (classification has no target column).");
    var nameMap = Core.makeNameMap(header);
    var train = parseData(files.train, nameMap, "train.dat");
    if (info.classCounts.reduce(function (a, b) { return a + b; }, 0) !== train.n) throw new Error("nsample category counts do not add up to train.dat rows.");
    train.labels = [];
    info.classCounts.forEach(function (n, c) { for (var i = 0; i < n; i++) train.labels.push(c); });
    var classes = labelsFromJson(files.trainlabels, train, info.classCounts.length, train.labels) ||
      info.classCounts.map(function (_, i) { return "Class " + (i + 1); });
    var verify = files.verify ? parseData(files.verify, nameMap, "verify.dat") : null;
    if (files.verifylabels && !verify) throw new Error("verify_labels.json requires verify.dat.");
    if (verify) {
      var verifyClasses = labelsFromJson(files.verifylabels, verify, classes.length, null, files.trainlabels ? classes : null);
      if (verifyClasses && !files.trainlabels) classes = verifyClasses;
    }
    var models = parseTop(files.top, info.descDim);
    var needed = new Set();
    models.forEach(function (m) { m.featureIds.forEach(function (id) { needed.add(id); }); });
    var uspace = Core.parseUspace(files.uspace, Core.buildRenamer(nameMap.slice(1)), needed);
    var compiled = new Set();
    models.forEach(function (m) {
      if (m.dataOverlap > train.n * (classes.length - 1)) throw new Error("Model overlap count exceeds the category-pair sample bound.");
      m.descriptors = m.featureIds.map(function (id) {
        var expr = uspace.idToRenamed.get(id);
        if (expr === undefined) throw new Error("Descriptor " + id + " missing from Uspace.expressions.");
        if (!compiled.has(id)) {
          Core.compileFormula(expr)(function (letter) {
            if (!train.featureLetters.includes(letter)) throw new Error("Unknown feature in descriptor " + id + ".");
            return 1;
          });
          compiled.add(id);
        }
        return { id: id, original: uspace.idToOrig.get(id), renamed: expr };
      });
    });
    var result = { taskType: "classification", train: train, verify: verify, models: models, classes: classes,
      hasClassNames: !!(files.trainlabels || files.verifylabels),
      meta: { taskType: "classification", targetName: "Classification", nModels: models.length,
        nTrain: train.n, nVerify: verify ? verify.n : 0, nFeatures: header.length - 1, sissoIn: info },
      columns: nameMap.map(function (r, i) { return { letter: r.new_name, original: r.original_name, role: i ? "feature" : "name" }; }) };
    var top1 = models.find(function (m) { return m.rank === 1; });
    if (files.classdesc) {
      if (!top1) throw new Error("Official top1 descriptors require model rank 1.");
      top1.official = parseOfficial(files.classdesc, projectModel(result, top1, "train"), info.descDim);
    }
    if (files.classhull) {
      if (info.descDim !== 2 || !top1 || !top1.official) throw new Error("convex2D_hull requires matching 2D top1 descriptor data.");
      top1.hulls = parseHulls(files.classhull, info, top1.official);
    }
    return result;
  }

  function convexHull(points) {
    var sorted = points.filter(function (p) { return p.length === 2 && p.every(Number.isFinite); })
      .map(function (p) { return p.slice(); }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var unique = sorted.filter(function (p, i) { return !i || p[0] !== sorted[i - 1][0] || p[1] !== sorted[i - 1][1]; });
    if (unique.length <= 2) return unique;
    var scale = [0, 0];
    unique.forEach(function (p) { for (var i = 0; i < 2; i++) scale[i] = Math.max(scale[i], Math.abs(p[i])); });
    // Positive axis scaling preserves the hull while keeping cross products finite.
    var nodes = unique.map(function (p) { return { point: p, x: p[0] / (scale[0] || 1), y: p[1] / (scale[1] || 1) }; });
    function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    function half(list) {
      var hull = [];
      list.forEach(function (p) {
        while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
        hull.push(p);
      });
      hull.pop();
      return hull;
    }
    return half(nodes).concat(half(nodes.slice().reverse())).map(function (p) { return p.point; });
  }

  function rebuildHulls(trainingPoints, nClasses, dim) {
    var groups = Array.from({ length: nClasses }, function () { return []; });
    trainingPoints.forEach(function (p) {
      if (p.finite && Number.isInteger(p.classIndex) && p.classIndex >= 0 && p.classIndex < nClasses) groups[p.classIndex].push(p.coords);
    });
    return groups.map(function (points) {
      if (dim === 2) return convexHull(points);
      if (!points.length) return [];
      var values = points.map(function (p) { return p[0]; }).filter(Number.isFinite).sort(function (a, b) { return a - b; });
      if (!values.length) return [];
      return values[0] === values[values.length - 1] ? [[values[0]]] : [[values[0]], [values[values.length - 1]]];
    });
  }

  function exportRows(result, model, dataset) {
    if (dataset === "verify" && !hasVerificationLabels(result)) throw new Error("Verification requires complete class labels.");
    var rows = [["sample_id", "class_index", "class_label", "descriptor_1"]];
    if (result.meta.sissoIn.descDim === 2) rows[0].push("descriptor_2");
    rows[0].push("official_classified", "finite");
    if (dataset === "both") rows[0].unshift("dataset");
    (dataset === "both" ? (hasVerificationLabels(result) ? ["train", "verify"] : ["train"]) : [dataset]).forEach(function (key) {
      projectModel(result, model, key).forEach(function (p) {
        var row = [p.name, p.classIndex === null ? "" : p.classIndex,
          p.classIndex === null ? "" : "Category " + (p.classIndex + 1)].concat(p.coords, [p.classified || "", p.finite]);
        if (dataset === "both") row.unshift(key);
        rows.push(row);
      });
    });
    return rows;
  }

  return { isClassification: isClassification, runPipeline: runPipeline, projectModel: projectModel,
    convexHull: convexHull, rebuildHulls: rebuildHulls, exportRows: exportRows,
    hasVerificationLabels: hasVerificationLabels, labelsFromCounts: labelsFromCounts, verificationLabelText: verificationLabelText };
});
