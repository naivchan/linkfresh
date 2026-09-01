javascript:(function(){
  const ENDPOINT = "https://yourdomain.com/api/archive-link";
  const PASSCODE = "YOUR_ARCHIVE_SECRET";

  try {
    const pageUrl = window.location.href;
    const pageHtml = document.documentElement.outerHTML;

    const statusDiv = document.createElement("div");
    Object.assign(statusDiv.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      zIndex: "999999999",
      background: "#1a1a1a",
      color: "#ffffff",
      padding: "12px 18px",
      borderRadius: "6px",
      fontFamily: "sans-serif",
      fontSize: "13px",
      borderLeft: "4px solid #0066cc",
      boxShadow: "0 4px 12px rgba(0,0,0,0.4)"
    });
    statusDiv.innerText = "Archiving page DOM...";
    (document.body || document.documentElement).appendChild(statusDiv);

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: pageUrl, passcode: PASSCODE, html: pageHtml })
    })
    .then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save archive");
      return data;
    })
    .then((data) => {
      statusDiv.style.borderLeftColor = "#28a745";
      statusDiv.innerText = "Archived! Saved to " + data.path;
      console.log("Archive success:", data);
    })
    .catch((err) => {
      statusDiv.style.borderLeftColor = "#dc3545";
      statusDiv.innerText = "Error: " + err.message;
      console.error("Archive error:", err);
    })
    .finally(() => {
      setTimeout(() => { if (statusDiv.parentNode) statusDiv.remove(); }, 5000);
    });
  } catch(e) {
    alert("Bookmarklet failed to execute: " + e.message);
  }
})();