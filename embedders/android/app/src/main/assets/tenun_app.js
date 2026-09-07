// TenunJS Reference Prototype App
// Two text fields ("Title", "Details"), "Add Entry" button, and entry list
(function() {
  var state = {
    title: "",
    details: "",
    entries: []
  };

  function render() {
    var children = [
      { id: 1, type: "input", field: "title", value: state.title, placeholder: "Title" },
      { id: 2, type: "input", field: "details", value: state.details, placeholder: "Details" },
      { id: 3, type: "button", text: "Add Entry", action: "ADD_ENTRY" }
    ];
    for (var i = 0; i < state.entries.length; i++) {
      children.push({
        id: 100 + i,
        type: "listItem",
        title: state.entries[i].title,
        details: state.entries[i].details
      });
    }
    var scene = {
      root: { id: 0, type: "column", children: children },
      entryCount: state.entries.length
    };
    // Commit transaction to native host
    if (typeof tenun_commit === "function") {
      tenun_commit(JSON.stringify(scene));
    } else if (typeof globalThis.__tenun_last_scene !== "undefined") {
      globalThis.__tenun_last_scene = JSON.stringify(scene);
    }
  }

  globalThis.__tenun_dispatch_action = function(action, payloadJson) {
    var payload = {};
    try {
      payload = JSON.parse(payloadJson || "{}");
    } catch (e) {
      payload = {};
    }

    if (action === "SET_FIELD") {
      if (payload.field === "title") state.title = payload.value || "";
      if (payload.field === "details") state.details = payload.value || "";
      render();
    } else if (action === "ADD_ENTRY") {
      if (state.title && state.title.trim().length > 0) {
        state.entries.push({
          title: state.title.trim(),
          details: (state.details || "").trim()
        });
        state.title = "";
        state.details = "";
        render();
      }
    } else if (action === "GET_STATE") {
      return JSON.stringify(state);
    }
    return JSON.stringify(state);
  };

  // Initial mount
  render();
})();
