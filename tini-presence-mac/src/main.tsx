import ReactDOM from "react-dom/client";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";

async function setupMenu() {
  const aboutSubmenu = await Submenu.new({
    text: "tini-presence",
    items: [
      await MenuItem.new({
        id: "about",
        text: "About tini-presence",
        action: () => {
          window.alert("tini-presence\n\nDiscord Rich Presence for Spotify local files.");
        },
      }),
      await PredefinedMenuItem.new({ text: "separator", item: "Separator" }),
      await MenuItem.new({
        id: "quit",
        text: "Quit",
        action: () => invoke("quit_app"),
      }),
    ],
  });

  const serviceSubmenu = await Submenu.new({
    text: "Service",
    items: [
      await MenuItem.new({
        id: "toggle",
        text: "Start/Stop",
        action: () => invoke("toggle_service"),
      }),
    ],
  });

  const editSubmenu = await Submenu.new({
    text: "Edit",
    items: [
      await PredefinedMenuItem.new({ text: "undo", item: "Undo" }),
      await PredefinedMenuItem.new({ text: "redo", item: "Redo" }),
      await PredefinedMenuItem.new({ text: "separator", item: "Separator" }),
      await PredefinedMenuItem.new({ text: "cut", item: "Cut" }),
      await PredefinedMenuItem.new({ text: "copy", item: "Copy" }),
      await PredefinedMenuItem.new({ text: "paste", item: "Paste" }),
      await PredefinedMenuItem.new({ text: "select_all", item: "SelectAll" }),
    ],
  });

  const menu = await Menu.new({
    items: [aboutSubmenu, serviceSubmenu, editSubmenu],
  });

  await menu.setAsAppMenu();
}

void setupMenu();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);
