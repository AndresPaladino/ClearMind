import { useEffect, useRef, useCallback, useState } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";

import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import {
  TRANSFORMERS,
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  $createParagraphNode,
  KEY_BACKSPACE_COMMAND,
  FORMAT_TEXT_COMMAND,
  COMMAND_PRIORITY_LOW,
  type LexicalEditor,
} from "lexical";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import { $isListNode, $isListItemNode } from "@lexical/list";
import { Entry } from "../types";

interface EditorProps {
  entry: Entry;
  onContentChange: (content: string) => void;
  onSeal: () => void;
  onTypingStart: () => void;
  onTypingStop: () => void;
  onEditorReady?: (editor: LexicalEditor) => void;
}

function EditorReadyPlugin({ onReady }: { onReady?: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    onReady?.(editor);
  }, [editor, onReady]);
  return null;
}

function BlockResetPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false;
        }

        const { anchor } = selection;
        if (anchor.offset !== 0) return false;

        const anchorNode = anchor.getNode();

        // For text nodes, ensure cursor is at the very start of the block
        if (anchor.type === "text" && anchorNode.getPreviousSibling() !== null) {
          return false;
        }

        // Determine the block-level element
        const block =
          anchor.type === "element"
            ? anchorNode
            : anchorNode.getTopLevelElementOrThrow();

        // Headings & quotes → paragraph
        if ($isHeadingNode(block) || $isQuoteNode(block)) {
          event?.preventDefault();
          const p = $createParagraphNode();
          block.getChildren().forEach((c) => p.append(c));
          block.replace(p);
          p.selectStart();
          return true;
        }

        // Lists → lift the first list item out as a paragraph
        let listItem = null;
        let listNode = null;

        if ($isListItemNode(block)) {
          listItem = block;
          listNode = block.getParent();
        } else if ($isListNode(block)) {
          const parent = anchorNode.getParent();
          if ($isListItemNode(parent)) {
            listItem = parent;
            listNode = block;
          }
        }

        if (listItem && listNode) {
          if (listItem.getPreviousSibling() !== null) return false;

          event?.preventDefault();
          const p = $createParagraphNode();
          listItem.getChildren().forEach((c) => p.append(c));

          if (listItem.getNextSibling() === null) {
            listNode.replace(p);
          } else {
            listNode.insertBefore(p);
            listItem.remove();
          }
          p.selectStart();
          return true;
        }

        return false;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor]);

  return null;
}

function StrikethroughPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
      }
    };
    return editor.registerRootListener((root, prev) => {
      prev?.removeEventListener("keydown", onKeyDown);
      root?.addEventListener("keydown", onKeyDown);
    });
  }, [editor]);

  return null;
}

function CursorRestorePlugin({ entryId }: { entryId: string }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      // discrete:true makes the update synchronous — cursor is in the DOM and
      // the browser auto-scroll has already fired before this line returns.
      editor.update(() => {
        const root = $getRoot();
        const stored = localStorage.getItem(`clearmind-cursor-${entryId}`);
        if (stored) {
          try {
            const { b: blockIndex, o: offsetInBlock } = JSON.parse(stored);
            const children = root.getChildren();
            if (blockIndex < children.length) {
              const block = children[blockIndex];
              if (!$isElementNode(block)) {
                root.selectEnd();
              } else {
                const textNodes = block.getAllTextNodes();
                if (textNodes.length === 0) {
                  block.selectStart();
                } else {
                  let remaining = offsetInBlock;
                  let placed = false;
                  for (const tn of textNodes) {
                    const len = tn.getTextContentSize();
                    if (remaining <= len) {
                      tn.select(remaining, remaining);
                      placed = true;
                      break;
                    }
                    remaining -= len;
                  }
                  if (!placed) block.selectEnd();
                }
              }
            } else {
              root.selectEnd();
            }
          } catch {
            root.selectEnd();
          }
        } else {
          const lastChild = root.getLastDescendant();
          if (lastChild) lastChild.selectEnd();
          else root.selectEnd();
        }
      }, { discrete: true });

      // Focus without triggering another browser scroll.
      editor.getRootElement()?.focus({ preventScroll: true });

      // Correct scroll in the same frame before the browser paints —
      // discrete:true ensures the selection is already in the DOM so
      // getBoundingClientRect() returns the real cursor position.
      const container = document.querySelector(".scroll-container") as HTMLElement | null;
      if (container) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const cursorRect = sel.getRangeAt(0).getBoundingClientRect();
          if (cursorRect.height > 0) {
            const containerRect = container.getBoundingClientRect();
            const cursorTopRelative = cursorRect.top - containerRect.top;
            const targetFromTop = container.clientHeight * 0.30;
            container.scrollTop += cursorTopRelative - targetFromTop;
          }
        }
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [editor, entryId]);

  return null;
}

function EditorSyncPlugin({
  entryId,
  markdown,
  onLoadDone,
}: {
  entryId: string;
  markdown: string;
  onLoadDone: () => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.update(() => {
      $convertFromMarkdownString(markdown, TRANSFORMERS);
    });
    requestAnimationFrame(onLoadDone);
  }, [editor, entryId, markdown, onLoadDone]);

  return null;
}

export default function Editor({
  entry,
  onContentChange,
  onSeal,
  onTypingStart,
  onTypingStop,
  onEditorReady,
}: EditorProps) {
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadedRef = useRef(false);
  const lexicalRef = useRef<LexicalEditor | null>(null);
  const [isEntryEmpty, setIsEntryEmpty] = useState(() => entry.content.trim().length === 0);

  useEffect(() => {
    isLoadedRef.current = false;
  }, [entry.id]);

  useEffect(() => {
    setIsEntryEmpty(entry.content.trim().length === 0);
  }, [entry.id, entry.content]);

  const handleLoadDone = useCallback(() => {
    isLoadedRef.current = true;
  }, []);

  const handleEditorReady = useCallback((e: LexicalEditor) => {
    lexicalRef.current = e;
    onEditorReady?.(e);
  }, [onEditorReady]);

  const handleContentChange = useCallback(
    (markdown: string) => {
      setIsEntryEmpty(markdown.trim().length === 0);
      onContentChange(markdown);
      onTypingStart();

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = setTimeout(() => {
        onTypingStop();
      }, 1500);
    },
    [onContentChange, onTypingStart, onTypingStop]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      // Tab inserts indentation in the editor instead of moving focus away.
      if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        lexicalRef.current?.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.insertText("\t");
          }
        });
        return;
      }

      // Shift+Enter → seal entry
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        onSeal();
      }
    },
    [onSeal]
  );

  const initialConfig = {
    namespace: "clearmind-editor",
    theme: {
      heading: {
        h1: "editor-h1",
        h2: "editor-h2",
        h3: "editor-h3",
      },
      list: {
        ul: "editor-ul",
        ol: "editor-ol",
        listitem: "editor-li",
      },
      text: {
        bold: "editor-bold",
        italic: "editor-italic",
        strikethrough: "editor-strike",
      },
      quote: "editor-quote",
      code: "editor-code",
    },
    onError(error: Error) {
      throw error;
    },
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode],
  };

  return (
    <div className="editor-area">
      <LexicalComposer key={entry.id} initialConfig={initialConfig}>
        <EditorReadyPlugin onReady={handleEditorReady} />
        <EditorSyncPlugin
          entryId={entry.id}
          markdown={entry.content}
          onLoadDone={handleLoadDone}
        />
        <CursorRestorePlugin entryId={entry.id} />
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="editor-textarea"
              onKeyDown={handleKeyDown}
              spellCheck={false}
            />
          }
          placeholder={<div className="editor-placeholder" aria-hidden="true" />}
          ErrorBoundary={() => null}
        />
        <div
          className={`editor-inline-hint${isEntryEmpty ? " visible" : ""}`}
          aria-hidden="true"
        >
          <p className="editor-inline-hint-main">Start writing...</p>
          <p className="editor-inline-hint-line">
            <kbd>Shift</kbd> + <kbd>Enter</kbd> to finish this entry
          </p>
          <p className="editor-inline-hint-line">
            <kbd>⌘</kbd> + <kbd>K</kbd> for commands
          </p>
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <BlockResetPlugin />
        <StrikethroughPlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <OnChangePlugin
          onChange={(editorState) => {
            // Skip mount-time changes from EditorSyncPlugin / CursorRestorePlugin
            if (!isLoadedRef.current) return;

            editorState.read(() => {
              const markdown = $convertToMarkdownString(TRANSFORMERS);
              handleContentChange(markdown);
            });

            // Save cursor position (debounced)
            if (lexicalRef.current) {
              if (cursorSaveRef.current) clearTimeout(cursorSaveRef.current);
              cursorSaveRef.current = setTimeout(() => {
                lexicalRef.current?.getEditorState().read(() => {
                  const selection = $getSelection();
                  if (!$isRangeSelection(selection)) return;

                  const anchor = selection.anchor;
                  const root = $getRoot();
                  let blockIndex: number;
                  let offsetInBlock: number;

                  if (anchor.type === "element") {
                    const element = anchor.getNode();
                    const topElement = element.getTopLevelElement() || element;
                    blockIndex = root.getChildren().indexOf(topElement);
                    offsetInBlock = 0;
                  } else {
                    const textNode = anchor.getNode();
                    const topElement = textNode.getTopLevelElementOrThrow();
                    blockIndex = root.getChildren().indexOf(topElement);
                    offsetInBlock = 0;
                    const allTextNodes = topElement.getAllTextNodes();
                    for (const tn of allTextNodes) {
                      if (tn.is(textNode)) {
                        offsetInBlock += anchor.offset;
                        break;
                      }
                      offsetInBlock += tn.getTextContentSize();
                    }
                  }

                  if (blockIndex >= 0) {
                    localStorage.setItem(
                      `clearmind-cursor-${entry.id}`,
                      JSON.stringify({ b: blockIndex, o: offsetInBlock })
                    );
                  }
                });
              }, 300);
            }
          }}
        />
      </LexicalComposer>
    </div>
  );
}
