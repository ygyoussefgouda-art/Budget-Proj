// "Try again": go back to the live site (the app's start URL). Capacitor serves this page from the APK.
document.getElementById('retry').addEventListener('click', function () {
  var cap = window.Capacitor;
  var start = cap && cap.getServerUrl ? cap.getServerUrl() : null;
  if (start) window.location.href = start;
  else window.location.reload();
});
