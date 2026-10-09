# Changelog

## 0.3.0

- Call chain view: callers above and callees below a function, one row per layer (Controller, Service, Repository and so on). Open it with **Wayfinder: Show call chain**, the editor right-click menu, or the icon on a function card. "+ deeper" loads one more level.
- Focus mode: one column in the centre with the other two at its sides. Cmd+Alt+Enter (Ctrl+Alt+Enter) turns it on or off, Alt+] and Alt+[ move between columns. `wayfinder.shortcut.columnFocus` turns off these keys.
- Interface files: the third column is "Implemented by", with the classes that implement it and the interfaces that extend it.
- React component files: a "Component tree" tab with the components that render this one and the ones it renders, and a Props group in Members.
- Member cards: a PUBLIC, PROTECTED, PRIVATE, EXPORTED or NOT EXPORTED tag, a usage count with the files that use the member, and the full name in the tooltip.
- Test files: the test outline in Members, other tests of the same subject, a "Tested code" column, and test groups from more test frameworks.
- Fixed: the tested file of a test was not always found.
- Fixed: clicking a card reset the map scroll position.

## 0.2.0

- Cmd+Alt+M (Ctrl+Alt+M) opens or shows the map and moves keyboard focus to the current file card. Press it again from the map to go back to the editor at the same cursor. `wayfinder.shortcut.focusMap` and `wayfinder.shortcut.returnToEditor` turn off each part.
- Fixed: closing the map left an empty locked editor group, so files opened afterwards only used part of the window.

## 0.1.0

- Map of the open file in a panel beside the editor: files that import it, files and packages it imports, its members, its tests, and a second layer one step further out.
- Cards grouped by kind, a search box in each column, and keyboard navigation. The member at the editor cursor is highlighted.
- Checks from the code: files the folder pattern expects but that are missing, and circular imports, listed in the side panel's Checks tab.
- Scan with AI: a summary and things worth checking for the open file, from a local Ollama model.
- Cloud scan through the Claude Code or Codex CLI, with a prompt before the first scan in a workspace.
- Team rules in `.wayfinder/rules.md`, your own rules in `wayfinder.ai.instructions`, and `wayfinder.ai.scope` to also send direct imports, callers and tests.
- Commands: Show map for this file, Choose AI model, Create AI rules file.
