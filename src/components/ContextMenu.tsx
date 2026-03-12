import { Menu, PredefinedMenuItem, MenuItem, Submenu } from "@tauri-apps/api/menu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import {
  FORMAT_TEXT_COMMAND,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  type LexicalEditor,
} from "lexical";
import { $setBlocksType } from "@lexical/selection";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import {
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  $removeList,
} from "@lexical/list";

export async function showContextMenu(
  x: number,
  y: number,
  editor: LexicalEditor
) {
  const formatSubmenu = await Submenu.new({
    text: "Format",
    items: [
      await MenuItem.new({
        text: "Bold",
        accelerator: "CmdOrCtrl+B",
        action: () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold"),
      }),
      await MenuItem.new({
        text: "Italic",
        accelerator: "CmdOrCtrl+I",
        action: () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic"),
      }),
      await MenuItem.new({
        text: "Strikethrough",
        action: () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough"),
      }),
    ],
  });

  const paragraphSubmenu = await Submenu.new({
    text: "Paragraph",
    items: [
      await MenuItem.new({
        text: "Normal text",
        action: () =>
          editor.update(() => {
            const sel = $getSelection();
            if ($isRangeSelection(sel))
              $setBlocksType(sel, () => $createParagraphNode());
          }),
      }),
      await MenuItem.new({
        text: "Heading 1",
        action: () =>
          editor.update(() => {
            const sel = $getSelection();
            if ($isRangeSelection(sel))
              $setBlocksType(sel, () => $createHeadingNode("h1"));
          }),
      }),
      await MenuItem.new({
        text: "Heading 2",
        action: () =>
          editor.update(() => {
            const sel = $getSelection();
            if ($isRangeSelection(sel))
              $setBlocksType(sel, () => $createHeadingNode("h2"));
          }),
      }),
      await MenuItem.new({
        text: "Heading 3",
        action: () =>
          editor.update(() => {
            const sel = $getSelection();
            if ($isRangeSelection(sel))
              $setBlocksType(sel, () => $createHeadingNode("h3"));
          }),
      }),
      await MenuItem.new({
        text: "Quote",
        action: () =>
          editor.update(() => {
            const sel = $getSelection();
            if ($isRangeSelection(sel))
              $setBlocksType(sel, () => $createQuoteNode());
          }),
      }),
    ],
  });

  const insertSubmenu = await Submenu.new({
    text: "Insert",
    items: [
      await MenuItem.new({
        text: "Bullet list",
        action: () =>
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
      }),
      await MenuItem.new({
        text: "Numbered list",
        action: () =>
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
      }),
      await MenuItem.new({
        text: "Remove list",
        action: () =>
          editor.update(() => {
            $removeList();
          }),
      }),
    ],
  });

  const menu = await Menu.new({
    items: [
      formatSubmenu,
      paragraphSubmenu,
      insertSubmenu,
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Cut" }),
      await PredefinedMenuItem.new({ item: "Copy" }),
      await PredefinedMenuItem.new({ item: "Paste" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Undo" }),
      await PredefinedMenuItem.new({ item: "Redo" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "SelectAll" }),
    ],
  });

  await menu.popup(new LogicalPosition(x, y));
}
