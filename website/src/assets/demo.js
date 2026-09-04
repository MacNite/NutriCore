/**
 * Demo page interaction.
 *
 * The markup already contains every panel, every day and every search result,
 * so this file only ever hides, shows and filters what is already there. That
 * is why the page still works with scripting disabled - and why nothing here
 * has to know how a nutrient is formatted.
 */
(function () {
  "use strict";

  var shell = document.querySelector(".demo-shell");
  if (!shell) return;

  /* --- Panels ------------------------------------------------------------ */
  var tabs = Array.prototype.slice.call(shell.querySelectorAll("[role='tab']"));
  var panels = Array.prototype.slice.call(shell.querySelectorAll(".demo-panel"));
  var heading = shell.querySelector("[data-demo-heading]");
  var daySwitch = shell.querySelector("[data-day-switch]");

  var selectTab = function (index) {
    tabs.forEach(function (tab, position) {
      var selected = position === index;
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.tabIndex = selected ? 0 : -1;
      panels[position].hidden = !selected;
      if (selected && heading) heading.textContent = tab.textContent.trim();
    });
    // The day chips only mean something on the diary panel.
    if (daySwitch) daySwitch.style.visibility = index === 0 ? "visible" : "hidden";
  };

  tabs.forEach(function (tab, index) {
    tab.addEventListener("click", function () {
      selectTab(index);
    });
    tab.addEventListener("keydown", function (event) {
      var offset = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
      if (!offset) return;
      event.preventDefault();
      var next = (index + offset + tabs.length) % tabs.length;
      tabs[next].focus();
      selectTab(next);
    });
  });

  /* --- Day switch -------------------------------------------------------- */
  var dayButtons = Array.prototype.slice.call(shell.querySelectorAll("[data-day-button]"));
  var dayPanels = Array.prototype.slice.call(shell.querySelectorAll("[data-day]"));
  var dateLabel = shell.querySelector("[data-demo-date]");

  dayButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      var id = button.getAttribute("data-day-button");
      dayButtons.forEach(function (other) {
        other.classList.toggle("chip-accent", other === button);
      });
      dayPanels.forEach(function (panel) {
        panel.hidden = panel.getAttribute("data-day") !== id;
      });
      if (dateLabel) dateLabel.textContent = button.getAttribute("data-long");

      // A bar animates from its rendered width, so replaying the transition is
      // what makes switching days feel like the real screen rather than a swap.
      Array.prototype.forEach.call(shell.querySelectorAll("[data-day='" + id + "'] .bar i"), function (fill) {
        var width = fill.style.width;
        fill.style.width = "0%";
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            fill.style.width = width;
          });
        });
      });
    });
  });

  /* --- Search ------------------------------------------------------------ */
  var input = shell.querySelector("[data-search-input]");
  var results = Array.prototype.slice.call(shell.querySelectorAll("[data-search-list] .result"));
  var count = shell.querySelector("[data-search-count]");
  var empty = shell.querySelector("[data-search-empty]");

  if (input) {
    input.addEventListener("input", function () {
      var query = input.value.trim().toLowerCase();
      var visible = 0;

      results.forEach(function (result) {
        var match = !query || result.getAttribute("data-name").indexOf(query) !== -1;
        result.hidden = !match;
        if (match) visible += 1;
      });

      // "Treffer" is its own plural, so no branch is needed here.
      if (count) count.textContent = visible + " Treffer";
      if (empty) empty.hidden = visible !== 0;
    });
  }
})();
