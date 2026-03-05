module.exports = {
  apps: [
    {
      name: 'ogz-websocket',
      script: 'ogzprime-ssl-server.js',
      cwd: '/opt/ogzprime/OGZPMLV2',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3010
      }
    },
    {
      name: 'ogz-prime-v2',
      script: 'run-empire-v2.js',
      cwd: '/opt/ogzprime/OGZPMLV2',
      watch: false,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'ogz-stripe',
      script: 'public/stripe-checkout.js',
      cwd: '/opt/ogzprime/OGZPMLV2',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    }
  ]
};
