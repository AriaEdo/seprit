import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";

export interface FileActions {
  newFile: () => void;
  open: () => void;
  save: () => void;
  saveAs: () => void;
  exportSheet: () => void;
  importImage: () => void;
  aiSettings: () => void;
  generateSprite: () => void;
}

// Adds our items to the top of the OS default "File" menu, keeping the rest of the default
// menu (Edit gives copy/paste in text inputs on macOS; Quit, Close Window, etc.).
export async function setupAppMenu(actions: FileActions): Promise<void> {
  const menu = await Menu.default();
  const items = await menu.items();
  const texts = await Promise.all(items.map((i) => (i instanceof Submenu ? i.text() : null)));
  const found = items[texts.indexOf("File")];
  // Tauri's default menu has no "File" on Linux.
  const file = found instanceof Submenu ? found : await Submenu.new({ text: "File" });
  if (file !== found) await menu.prepend(file);
  await file.prepend([
    await MenuItem.new({ text: "New", accelerator: "CmdOrCtrl+N", action: actions.newFile }),
    await MenuItem.new({ text: "Open…", accelerator: "CmdOrCtrl+O", action: actions.open }),
    await MenuItem.new({ text: "Save", accelerator: "CmdOrCtrl+S", action: actions.save }),
    await MenuItem.new({ text: "Save As…", accelerator: "CmdOrCtrl+Shift+S", action: actions.saveAs }),
    await PredefinedMenuItem.new({ item: "Separator" }),
    await MenuItem.new({ text: "Export…", accelerator: "CmdOrCtrl+E", action: actions.exportSheet }),
    await MenuItem.new({ text: "Import Image…", accelerator: "CmdOrCtrl+I", action: actions.importImage }),
    await PredefinedMenuItem.new({ item: "Separator" }),
    await MenuItem.new({ text: "Generate Sprite…", accelerator: "CmdOrCtrl+G", action: actions.generateSprite }),
    await MenuItem.new({ text: "AI Settings…", accelerator: "CmdOrCtrl+,", action: actions.aiSettings }),
    await PredefinedMenuItem.new({ item: "Separator" }),
  ]);
  await menu.setAsAppMenu();
}
