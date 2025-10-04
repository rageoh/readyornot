/* Smart Business Assistant - Shopping List Generator */
(function() {
  "use strict";

  /** DOM Elements */
  const businessTypeInput = document.getElementById("businessType");
  const weeklyRevenueInput = document.getElementById("weeklyRevenue");
  const bufferPercentInput = document.getElementById("bufferPercent");
  const bufferPercentValue = document.getElementById("bufferPercentValue");

  const itemsContainer = document.getElementById("itemsContainer");
  const addItemButton = document.getElementById("addItemButton");

  const bulkInput = document.getElementById("bulkInput");
  const parseBulkButton = document.getElementById("parseBulkButton");

  const generateButton = document.getElementById("generateButton");
  const copyButton = document.getElementById("copyButton");
  const downloadButton = document.getElementById("downloadButton");
  const resetButton = document.getElementById("resetButton");

  const outputPre = document.getElementById("outputText");

  const mobileToggle = document.getElementById("mobileToggle");
  const nav = document.getElementById("nav");
  const anchorLinks = document.querySelectorAll('a[href^="#"]');

  // New options controls
  const expandModeCheckbox = document.getElementById("expandMode");
  const includeEquipmentCheckbox = document.getElementById("includeEquipment");

  /** Utils */
  function createElement(tagName, className, attributes) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (attributes) {
      Object.entries(attributes).forEach(([key, value]) => {
        element.setAttribute(key, String(value));
      });
    }
    return element;
  }

  function toIntegerOrZero(value) {
    const parsed = Math.ceil(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function getBufferMultiplier() {
    const percent = Number(bufferPercentInput.value) || 0;
    return 1 + percent / 100;
  }

  function normalizeItemName(name) {
    return String(name || "").trim().replace(/\s+/g, " ");
  }

  function computeWeeklyQuantity(dailyUnits) {
    const multiplier = 7 * getBufferMultiplier();
    return Math.ceil(dailyUnits * multiplier);
  }

  /**
   * Simple recipe and equipment knowledge base
   * Units are per ONE product sold (daily units multiplier will be applied)
   */
  const recipes = {
    // Example burger decomposition
    burger: {
      ingredients: {
        "Burger buns": 1,
        "Beef patties": 1,
        "Cheese slices": 1,
        "Lettuce heads": 0.15,
        "Tomatoes": 0.2,
        "Onions": 0.1,
        "Pickle slices": 2,
        "Sauce (oz)": 1
      },
      equipment: {
        "Grill or griddle (units)": 0.003, // rough: 1 grill per ~300 burgers/day
        "Food prep gloves (boxes)": 0.01
      }
    },
    burgers: { alias: "burger" },

    soda: {
      ingredients: { "Soda cans": 1 },
      equipment: { "Ice (lbs)": 0.05 }
    },
    sodas: { alias: "soda" },

    bun: { ingredients: { "Burger buns": 1 } },
    buns: { alias: "bun" }
  };

  function resolveRecipeKey(name) {
    const key = String(name).toLowerCase().trim();
    if (recipes[key]?.alias) return recipes[recipes[key].alias] ? recipes[key].alias : key;
    return recipes[key] ? key : null;
  }

  function expandProductsToComponents(items, includeEquipment) {
    const componentTotals = new Map(); // name -> total DAILY units

    function addToTotals(componentName, addedDailyUnits) {
      const current = componentTotals.get(componentName) || 0;
      componentTotals.set(componentName, current + addedDailyUnits);
    }

    for (const { itemName, dailyUnits } of items) {
      const recipeKey = resolveRecipeKey(itemName);
      if (recipeKey) {
        const recipe = recipes[recipeKey];
        const baseKey = recipe.alias ? recipe.alias : recipeKey;
        const resolved = recipes[baseKey];
        if (resolved?.ingredients) {
          for (const [component, perUnit] of Object.entries(resolved.ingredients)) {
            addToTotals(component, dailyUnits * Number(perUnit));
          }
        }
        if (includeEquipment && resolved?.equipment) {
          for (const [equip, perUnit] of Object.entries(resolved.equipment)) {
            addToTotals(equip, dailyUnits * Number(perUnit));
          }
        }
      } else {
        addToTotals(itemName, dailyUnits);
      }
    }

    // Convert back to array
    return Array.from(componentTotals.entries()).map(([itemName, dailyUnits]) => ({ itemName, dailyUnits }));
  }

  /** Items list */
  function addItemRow(defaultName = "", defaultDailyUnits = "") {
    const row = createElement("div", "row");

    const nameInput = createElement("input", "input", {
      type: "text",
      placeholder: "Item name (e.g., Burgers)",
      inputmode: "text",
      autocomplete: "off",
      "aria-label": "Item name"
    });
    nameInput.value = defaultName;

    const qtyInput = createElement("input", "input", {
      type: "number",
      placeholder: "Avg daily units",
      inputmode: "numeric",
      min: "0",
      step: "1",
      "aria-label": "Average daily units"
    });
    qtyInput.value = String(defaultDailyUnits);

    const removeButton = createElement("button", "button ghost", { type: "button", title: "Remove item" });
    removeButton.innerText = "Remove";

    removeButton.addEventListener("click", () => {
      if (itemsContainer.children.length > 1) {
        itemsContainer.removeChild(row);
      } else {
        nameInput.value = "";
        qtyInput.value = "";
      }
    });

    row.appendChild(nameInput);
    row.appendChild(qtyInput);
    row.appendChild(removeButton);

    itemsContainer.appendChild(row);
    return row;
  }

  function readItemsFromUI() {
    const items = [];
    for (const row of itemsContainer.children) {
      const [nameInput, qtyInput] = row.querySelectorAll("input");
      const itemName = normalizeItemName(nameInput.value);
      const dailyUnits = toIntegerOrZero(qtyInput.value);
      if (!itemName || dailyUnits <= 0) continue;
      items.push({ itemName, dailyUnits });
    }
    return items;
  }

  function generateListText(items) {
    // Only output list lines: "- Item: Quantity"
    return items
      .map(({ itemName, dailyUnits }) => {
        const weeklyQuantity = computeWeeklyQuantity(dailyUnits);
        return `- ${itemName}: ${weeklyQuantity}`;
      })
      .join("\n");
  }

  /** Bulk input parsing */
  function parseBulkInput(text) {
    // Accepts formats like:
    // "Average daily sales: 200 burgers, 100 buns, 50 sodas"
    // Also accepts simple comma-separated "200 burgers, 50 sodas"
    const cleaned = String(text || "").replace(/\n+/g, " ").trim();
    if (!cleaned) return [];

    // Remove leading labels like "Average daily sales:" or "Sales:" or similar
    const withoutLabel = cleaned.replace(/^\s*[^:]+:\s*/i, "");

    // Split on commas
    const parts = withoutLabel
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    const items = [];
    for (const part of parts) {
      // Match pattern: number then item words
      const match = part.match(/(\d+(?:\.\d+)?)\s+(.+)/);
      if (!match) continue;
      const dailyUnits = toIntegerOrZero(match[1]);
      const itemName = normalizeItemName(match[2]);
      if (itemName && dailyUnits > 0) {
        items.push({ itemName, dailyUnits });
      }
    }
    return items;
  }

  function populateItems(items) {
    // Clear to a single empty row
    itemsContainer.innerHTML = "";
    if (items.length === 0) {
      addItemRow();
      return;
    }
    items.forEach(({ itemName, dailyUnits }) => addItemRow(itemName, dailyUnits));
  }

  /** Event wiring */
  function init() {
    // Default state
    addItemRow();
    bufferPercentValue.textContent = `${bufferPercentInput.value}%`;

    bufferPercentInput.addEventListener("input", () => {
      bufferPercentValue.textContent = `${bufferPercentInput.value}%`;
    });

    addItemButton.addEventListener("click", () => addItemRow());

    parseBulkButton.addEventListener("click", () => {
      const parsed = parseBulkInput(bulkInput.value);
      populateItems(parsed);
    });

    generateButton.addEventListener("click", () => {
      const baseItems = readItemsFromUI();
      const shouldExpand = !!expandModeCheckbox?.checked;
      const shouldIncludeEquipment = !!includeEquipmentCheckbox?.checked;

      const items = shouldExpand
        ? expandProductsToComponents(baseItems, shouldIncludeEquipment)
        : baseItems;

      const text = generateListText(items);
      outputPre.textContent = text || "";
      // Scroll to output
      outputPre.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    copyButton.addEventListener("click", async () => {
      const text = outputPre.textContent || "";
      if (!text.trim()) return;
      try {
        await navigator.clipboard.writeText(text);
        copyButton.textContent = "Copied";
        setTimeout(() => (copyButton.textContent = "Copy list"), 1200);
      } catch (_) {
        // Fallback: select text
        const range = document.createRange();
        range.selectNodeContents(outputPre);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand("copy");
        selection?.removeAllRanges();
      }
    });

    downloadButton.addEventListener("click", () => {
      const text = outputPre.textContent || "";
      if (!text.trim()) return;
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "shopping-list.txt";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    resetButton.addEventListener("click", () => {
      businessTypeInput.value = "";
      weeklyRevenueInput.value = "";
      bufferPercentInput.value = "10";
      bufferPercentValue.textContent = `10%`;
      bulkInput.value = "";
      outputPre.textContent = "";
      itemsContainer.innerHTML = "";
      addItemRow();
    });

    mobileToggle.addEventListener("click", () => {
      nav.classList.toggle("open");
    });

    // Smooth scroll for anchor links
    anchorLinks.forEach((link) => {
      link.addEventListener("click", (e) => {
        const href = link.getAttribute("href");
        if (!href || href === "#") return;
        const id = href.slice(1);
        const target = document.getElementById(id);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          nav.classList.remove("open");
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
