const React = require('react');
const { View } = require('react-native');

const WebView = React.forwardRef((props, ref) => React.createElement(View, { ...props, ref }));
WebView.displayName = 'MockWebView';
module.exports = { WebView };
