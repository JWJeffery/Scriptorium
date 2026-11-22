// Adding a book from Google Drive, entirely in the browser: Google's own sign-in gives a short-lived token with
// the narrowest Drive permission (drive.file: only the files you pick), Google's own Picker lets you choose a PDF,
// and the browser downloads it from the Drive API. Nothing is stored and the server never sees the token.
// Set up once with a free Google Cloud project (docs/CLOUD_IMPORT.md).

type GoogleSettings = { clientId: string; apiKey: string; appId: string | null };

/* Minimal typings for the two Google scripts this uses. */
type TokenResponse = { access_token?: string; error?: string; error_description?: string };
type GoogleGlobal = {
  accounts: { oauth2: { initTokenClient: (options: { client_id: string; scope: string; callback: (response: TokenResponse) => void; error_callback?: (error: { type?: string; message?: string }) => void }) => { requestAccessToken: (options?: { prompt?: string }) => void } } };
  picker: {
    PickerBuilder: new () => PickerBuilder;
    DocsView: new (viewId?: unknown) => { setMimeTypes: (types: string) => unknown; setIncludeFolders: (value: boolean) => unknown; setSelectFolderEnabled: (value: boolean) => unknown };
    ViewId: { DOCS: unknown };
    Action: { PICKED: string; CANCEL: string };
    Response: { ACTION: string; DOCUMENTS: string };
    Document: { ID: string; NAME: string; MIME_TYPE: string; SIZE_BYTES?: string };
  };
};
type PickerBuilder = {
  addView: (view: unknown) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  setTitle: (title: string) => PickerBuilder;
  setCallback: (callback: (data: Record<string, unknown>) => void) => PickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
};
type Win = Window & { google?: GoogleGlobal; gapi?: { load: (name: string, options: { callback: () => void; onerror?: () => void }) => void } };

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => { loaded.delete(src); reject(new Error("Google's sign-in could not be loaded. Check the connection and try again.")); };
      document.head.appendChild(script);
    }));
  }
  return loaded.get(src) as Promise<void>;
}

let cachedToken: { value: string; expires: number } | null = null;

async function getToken(clientId: string) {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const win = window as Win;
  return new Promise<string>((resolve, reject) => {
    const client = win.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (response) => {
        if (response.error || !response.access_token) { reject(new Error(response.error_description || "Google sign-in was not completed.")); return; }
        cachedToken = { value: response.access_token, expires: Date.now() + 50 * 60_000 };
        resolve(response.access_token);
      },
      error_callback: (error) => reject(new Error(error.type === "popup_closed" ? "Google sign-in was closed before it finished." : error.message || "Google sign-in failed."))
    });
    client.requestAccessToken({ prompt: "" });
  });
}

/** Opens Google's picker; resolves with the chosen PDF, or null if the picker was cancelled. */
export async function pickFromGoogleDrive(settings: GoogleSettings, onDownloading?: () => void): Promise<File | null> {
  await Promise.all([loadScript("https://accounts.google.com/gsi/client"), loadScript("https://apis.google.com/js/api.js")]);
  const win = window as Win;
  await new Promise<void>((resolve, reject) => win.gapi!.load("picker", { callback: resolve, onerror: () => reject(new Error("Google's file picker could not be loaded.")) }));
  const token = await getToken(settings.clientId);
  const google = win.google!;

  const picked = await new Promise<{ id: string; name: string } | null>((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS);
    view.setMimeTypes("application/pdf");
    view.setIncludeFolders(true);
    let builder = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(settings.apiKey)
      .setTitle("Choose a PDF to add to Scriptorium")
      .setCallback((data) => {
        const action = data[google.picker.Response.ACTION];
        if (action === google.picker.Action.PICKED) {
          const doc = (data[google.picker.Response.DOCUMENTS] as Array<Record<string, string>>)[0];
          resolve({ id: doc[google.picker.Document.ID], name: doc[google.picker.Document.NAME] || "book.pdf" });
        } else if (action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      });
    if (settings.appId) builder = builder.setAppId(settings.appId);
    builder.build().setVisible(true);
  });
  if (!picked) return null;

  onDownloading?.();
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(picked.id)}?alt=media`, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 401) { cachedToken = null; throw new Error("The Google sign-in expired. Try again."); }
  if (!response.ok) throw new Error(`Google Drive did not send the file (error ${response.status}).`);
  const name = /\.pdf$/i.test(picked.name) ? picked.name : `${picked.name}.pdf`;
  return new File([await response.blob()], name, { type: "application/pdf" });
}
