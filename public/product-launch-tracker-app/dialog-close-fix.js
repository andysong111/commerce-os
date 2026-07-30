const dialogForms = ["#detail-form", "#policy-form", "#add-form"];

for (const selector of dialogForms) {
  const form = document.querySelector(selector);
  const dialog = form?.closest("dialog");
  if (!form || !dialog) continue;

  for (const button of form.querySelectorAll("button[value='cancel']")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      dialog.close();
    });
  }
}
