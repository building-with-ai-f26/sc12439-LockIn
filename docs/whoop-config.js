// Whoop OAuth app settings for the in-game CONNECT WHOOP button.
// The client id is public by design (it only identifies the app to Whoop);
// the client secret stays in .env and GitHub secrets, never here.
// Leave clientId empty to hide the button. owner is who friends send their code to.
window.LOCKIN_WHOOP = {
  clientId: "a58c3456-3e5f-435b-8a12-f80ba651a7ea",
  redirectUri: "https://building-with-ai-f26.github.io/sc12439-LockIn/whoop-callback.html",
  owner: "Sheshu"
};
