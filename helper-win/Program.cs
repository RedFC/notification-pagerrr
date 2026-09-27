// Discord Pager - Windows notification helper.
//
// Reads toast notifications through UserNotificationListener and writes one JSON
// object per line to stdout. Electron spawns this process and parses the lines.
//
// Needs package identity (the app is installed as MSIX with the
// userNotificationListener capability) and a one-time user permission.
//
// Usage: NotificationHelper.exe [--all] [--interval-ms 1000]
//   --all   forward toasts from every app, not just Discord (used for capture logs)
//
// Output lines:
//   {"type":"status","access":"Allowed"}
//   {"type":"toast","id":"123","appId":"...","appName":"Discord","texts":["Title","Body"],"createdAt":"..."}
//   {"type":"error","message":"..."}

using System.Text.Json;
using Windows.UI.Notifications;
using Windows.UI.Notifications.Management;

var forwardAll = args.Contains("--all");
var interval = 1000;
var i = Array.IndexOf(args, "--interval-ms");
if (i >= 0 && i + 1 < args.Length && int.TryParse(args[i + 1], out var ms)) interval = Math.Max(250, ms);

var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
var outLock = new object();
void Emit(object o)
{
    lock (outLock)
    {
        Console.Out.WriteLine(JsonSerializer.Serialize(o, jsonOpts));
        Console.Out.Flush();
    }
}

// Exit when the parent (Electron) closes our stdin.
new Thread(() =>
{
    try { while (Console.In.Read() != -1) { } } catch { }
    Environment.Exit(0);
}) { IsBackground = true }.Start();

UserNotificationListener listener;
try
{
    listener = UserNotificationListener.Current;
}
catch (Exception ex)
{
    Emit(new { type = "error", message = $"UserNotificationListener unavailable (is the app installed as MSIX?): {ex.Message}" });
    return 2;
}

// Ask for access until granted. The first call shows the Windows permission prompt.
while (true)
{
    UserNotificationListenerAccessStatus access;
    try { access = await listener.RequestAccessAsync(); }
    catch (Exception ex)
    {
        // The prompt can fail outside a UI thread; access granted in Windows
        // Settings still shows up through GetAccessStatus.
        try { access = listener.GetAccessStatus(); }
        catch
        {
            Emit(new { type = "error", message = $"RequestAccessAsync failed: {ex.Message}" });
            await Task.Delay(10_000);
            continue;
        }
    }
    Emit(new { type = "status", access = access.ToString() });
    if (access == UserNotificationListenerAccessStatus.Allowed) break;
    Emit(new { type = "error", message = "Notification access not granted. Allow it in Settings > Privacy & security > Notifications." });
    await Task.Delay(10_000);
}

var seen = new HashSet<uint>();
var first = true;

while (true)
{
    try
    {
        var list = await listener.GetNotificationsAsync(NotificationKinds.Toast);
        var current = new HashSet<uint>();
        foreach (var n in list)
        {
            current.Add(n.Id);
            if (seen.Contains(n.Id)) continue;
            seen.Add(n.Id);
            // Items already in Action Center when we start are old; don't replay them.
            if (first) continue;

            string appName = "", appId = "";
            try
            {
                appName = n.AppInfo?.DisplayInfo?.DisplayName ?? "";
                appId = n.AppInfo?.AppUserModelId ?? "";
            }
            catch { /* some system toasts have no AppInfo */ }

            var isDiscord = appName.Contains("discord", StringComparison.OrdinalIgnoreCase)
                         || appId.Contains("discord", StringComparison.OrdinalIgnoreCase);
            if (!forwardAll && !isDiscord) continue;

            var texts = new List<string>();
            try
            {
                var binding = n.Notification?.Visual?.GetBinding(KnownNotificationBindings.ToastGeneric);
                if (binding != null)
                    foreach (var t in binding.GetTextElements()) texts.Add(t.Text ?? "");
            }
            catch (Exception ex)
            {
                Emit(new { type = "error", message = $"Could not read toast text: {ex.Message}" });
            }

            Emit(new
            {
                type = "toast",
                id = n.Id.ToString(),
                appId,
                appName,
                texts,
                createdAt = n.CreationTime.UtcDateTime.ToString("o")
            });
        }
        // Forget IDs that left Action Center so the set doesn't grow forever.
        seen.IntersectWith(current);
        first = false;
    }
    catch (Exception ex)
    {
        Emit(new { type = "error", message = $"GetNotificationsAsync failed: {ex.Message}" });
    }
    await Task.Delay(interval);
}
