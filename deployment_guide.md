# Collabrix Deployment Guide (100% Free / No CC)

To host your Collabrix environment, you will deploy **two separate components**. Follow this step-by-step file guide exactly.

---

## Phase 1: Deploying the Real-Time Backend Server (Render.com)

The backend handles WebSockets for Live Cursors, File Sync, and Docker environment handoffs. 

**Target Folder:** `C:\vscode2\Collabrix\extensions\collab-edit\collab-server`

1. **Prepare the Backend File**
   - Navigate to `extensions/collab-edit/collab-server`. This folder is essentially a completely independent Node.js project!
   - You need to host **only this directory** on Render.
   - Using Git, push this specific `collab-server` setup to a new GitHub repository (let's call it `github.com/YourUsername/collabrix-backend`).

2. **Deploy on Render (Zero Credit Card Needed)**
   - Go to [Render.com](https://render.com) and create an account using GitHub.
   - Click **New +** -> **Web Service**.
   - Select your new `collabrix-backend` repository.
   - **Environment:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm run start`
   - Select the **Free** tier and click Deploy!
   - Wait 2-3 minutes. Render will generate a URL like `collab-backend.onrender.com`.

3. **Link Your IDE to the newly deployed backend**
   - Go back to your IDE source code: `C:\vscode2\Collabrix\extensions\collab-edit\package.json`.
   - Scroll to line `162`: "collab.serverUrl".
   - Change `"ws://localhost:4000"` to `"wss://collab-backend.onrender.com"`.
   - Scroll to line `167`: "collab.serverHttpUrl".
   - Change `"http://localhost:4000"` to `"https://collab-backend.onrender.com"`.

**Success!** The collaboration server is officially deployed to the internet. 

---

## Phase 2: Deploying the Desktop Client (GitHub Releases)

Because Collabrix relies on native Node.js binaries and OS integration, it makes the most sense to distribute it as a Desktop `.exe`.

**Target Folders:** `C:\vscode2\Collabrix` 

1. **Re-Compile your UI and Setting Changes**
   - Open your terminal to the root project `C:\vscode2\Collabrix`.
   - Build the extension to lock in the Render URL:
     ```bash
     cd extensions/collab-edit
     npm run compile
     cd ../..
     ```
   - Compile the IDE itself:
     ```bash
     yarn watch
     # Wait for compilation to finish cleanly
     ```

2. **Package the Executable**
   - To build the `.exe` for Windows, run:
     ```bash
     yarn gulp vscode-win32-x64
     ```
   - *Note: Check the root `package.json` under scripts for your exact preferred builder script depending on the branch state!*

3. **Host the .exe for Free (GitHub Releases)**
   - Never host `.exe` files manually on websites because bandwidth is heavily metered.
   - Instead, go to your main `Collabrix` GitHub repository.
   - On the right side, click **Releases** -> **Create a new release**.
   - Set the tag to `v1.0.0-beta`.
   - Drag and drop your `.exe` (or zipped installer) output folder directly into the attachment box.
   - Click Publish! 

---

## Phase 3: Building a Marketing Site (Vercel)

Finally, you need a nice URL like `get-collabrix.vercel.app` where your friends and teammates can download the app.

1. **Create the Web Page**
   - Create a completely separate Github repository called `collabrix-website`.
   - Inside it, create an `index.html` file that features a large "Download for Windows" button linking directly to the GitHub `.exe` release you made in Phase 2!

2. **Deploy it for Free**
   - Go to [Vercel.com](https://vercel.com) and log in with GitHub.
   - Click **Add New Project**.
   - Select your `collabrix-website` repository.
   - Click Deploy.
   - Vercel instantly hosts your site for free with an auto-generated SSL certificate and zero credit card entries format.

---

### In Summary:
You don't need AWS, and you don't need a single cent.
* Your backend runs on **Render**.
* Your actual app is securely attached to **GitHub Releases**.
* Your landing page effortlessly serves people via **Vercel**.
