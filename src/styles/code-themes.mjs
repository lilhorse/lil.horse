function theme({ name, type, ui, code }) {
  return {
    name,
    type,
    colors: {
      'editor.background': ui.background,
      'editor.foreground': ui.foreground,
      'editor.selectionBackground': ui.selection,
      'editorGroupHeader.tabsBackground': ui.bar,
      'editorGroupHeader.tabsBorder': ui.border,
      'tab.activeBackground': ui.background,
      'tab.activeForeground': ui.foreground,
      'tab.activeBorderTop': '#00000000',
      'tab.activeBorder': '#00000000',
      'titleBar.activeBackground': ui.bar,
      'titleBar.activeForeground': ui.muted,
      'titleBar.border': ui.border,
      'terminal.background': ui.background,
      'terminal.foreground': ui.foreground,
      focusBorder: ui.focus,
    },
    tokenColors: [
      {
        scope: ['comment', 'punctuation.definition.comment'],
        settings: { foreground: code.comment, fontStyle: code.commentStyle },
      },
      {
        scope: [
          'keyword',
          'storage',
          'storage.type',
          'storage.modifier',
          'keyword.operator.new',
          'keyword.operator.expression',
          'entity.name.tag',
        ],
        settings: { foreground: code.keyword },
      },
      {
        scope: [
          'entity.name.function',
          'support.function',
          'variable.function',
          'meta.function-call.generic',
          'entity.other.attribute-name',
        ],
        settings: { foreground: code.function },
      },
      {
        scope: ['string', 'punctuation.definition.string', 'string.template'],
        settings: { foreground: code.string },
      },
      { scope: ['constant.numeric', 'constant.language'], settings: { foreground: code.number } },
    ],
  };
}

export const nightTheme = theme({
  name: 'night',
  type: 'dark',
  ui: {
    background: '#16161e',
    foreground: '#c0caf5',
    muted: '#8089b3',
    bar: '#16161e',
    border: '#292e42',
    selection: '#283457',
    focus: '#7aa2f7',
  },
  code: {
    keyword: '#bb9af7',
    function: '#7aa2f7',
    string: '#9ece6a',
    number: '#ff9e64',
    comment: '#8089b3',
    commentStyle: '',
  },
});

export const mistTheme = theme({
  name: 'mist',
  type: 'light',
  ui: {
    background: '#eaedf2',
    foreground: '#1f1b16',
    muted: '#6b6152',
    bar: '#e6e9ef',
    border: '#d8dde6',
    selection: '#c9e2ff',
    focus: '#1f4fd6',
  },
  code: {
    keyword: '#c92a2a',
    function: '#1f4fd6',
    string: '#2f7a2f',
    number: '#a35530',
    comment: '#6b6152',
    commentStyle: 'italic',
  },
});
