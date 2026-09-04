/**
 * Site behaviour. No framework and no build step: everything here is a small
 * progressive enhancement over markup that already reads correctly without it.
 */
(function () {
  "use strict";

  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --- Colour theme ------------------------------------------------------
     Three states, like the application: an explicit light or dark choice is
     stored, and no stored value means the operating system decides. */
  var toggle = document.querySelector("[data-theme-toggle]");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      var current = root.dataset.theme || (systemDark ? "dark" : "light");
      var next = current === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try {
        localStorage.setItem("nutricore-theme", next);
      } catch {
        /* Private mode: the choice simply does not persist. */
      }
    });
  }

  /* --- Masthead ---------------------------------------------------------- */
  var masthead = document.querySelector(".masthead");
  var menuButton = document.querySelector("[data-menu-toggle]");

  if (masthead) {
    var onScroll = function () {
      masthead.dataset.stuck = window.scrollY > 8 ? "true" : "false";
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  if (menuButton && masthead) {
    menuButton.addEventListener("click", function () {
      var open = masthead.dataset.open === "true";
      masthead.dataset.open = open ? "false" : "true";
      menuButton.setAttribute("aria-expanded", open ? "false" : "true");
    });
  }

  /* --- Reveal on scroll --------------------------------------------------
     Elements are hidden by CSS only while an observer exists to reveal them,
     so a browser without IntersectionObserver shows everything immediately. */
  var revealable = document.querySelectorAll("[data-reveal]");
  if (!reduceMotion && "IntersectionObserver" in window && revealable.length) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.06 },
    );
    revealable.forEach(function (element) {
      observer.observe(element);
    });
  } else {
    revealable.forEach(function (element) {
      element.classList.add("is-visible");
    });
  }

  /* --- Copy buttons ------------------------------------------------------ */
  document.querySelectorAll("[data-copy]").forEach(function (button) {
    button.addEventListener("click", function () {
      var block = button.closest(".code");
      var pre = block && block.querySelector("pre");
      if (!pre || !navigator.clipboard) return;
      navigator.clipboard.writeText(pre.innerText.trim()).then(function () {
        var label = button.textContent;
        button.dataset.copied = "true";
        button.textContent = "Copied";
        window.setTimeout(function () {
          button.dataset.copied = "false";
          button.textContent = label;
        }, 1600);
      });
    });
  });

  /* --- Tab sets ---------------------------------------------------------- */
  document.querySelectorAll("[data-tabset]").forEach(function (tabset) {
    var buttons = Array.prototype.slice.call(tabset.querySelectorAll("[role='tab']"));
    var panels = Array.prototype.slice.call(tabset.querySelectorAll("[role='tabpanel']"));

    var select = function (index) {
      buttons.forEach(function (button, position) {
        button.setAttribute("aria-selected", position === index ? "true" : "false");
        button.tabIndex = position === index ? 0 : -1;
      });
      panels.forEach(function (panel, position) {
        panel.hidden = position !== index;
      });
    };

    buttons.forEach(function (button, index) {
      button.addEventListener("click", function () {
        select(index);
      });
      button.addEventListener("keydown", function (event) {
        var offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!offset) return;
        event.preventDefault();
        var next = (index + offset + buttons.length) % buttons.length;
        buttons[next].focus();
        select(next);
      });
    });
  });

  /* --- Table-of-contents scrollspy --------------------------------------- */
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll(".toc a"));
  if (tocLinks.length && "IntersectionObserver" in window) {
    var sections = tocLinks
      .map(function (link) {
        return document.getElementById(link.getAttribute("href").slice(1));
      })
      .filter(Boolean);

    var mark = function (id) {
      tocLinks.forEach(function (link) {
        link.classList.toggle("is-active", link.getAttribute("href") === "#" + id);
      });
    };

    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) mark(entry.target.id);
        });
      },
      // A band across the upper third: the heading nearest the top wins,
      // rather than whichever section happens to be largest.
      { rootMargin: "-90px 0px -70% 0px", threshold: 0 },
    );
    sections.forEach(function (section) {
      spy.observe(section);
    });
  }
})();
