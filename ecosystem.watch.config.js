module.exports = {
  apps: [
    {
      name: 'ogz-prime-v2',
      script: './run-empire-v2.js',
      watch: true,  // Auto-restart on file changes
      watch_delay: 1000,
      ignore_watch: [
        'node_modules',
        'logs',
        'data',
        '.git',
        '*.log'
      ],
      watch_options: {
        followSymlinks: false
      },
      env: {
        NODE_ENV: 'development'
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000
    },
    {
      name: 'ogz-websocket',
      script: './ogzprime-ssl-server.js',
      watch: true,
      ignore_watch: [
        'node_modules',
        'logs',
        'data',
        '.git'
      ],
      env: {
        NODE_ENV: 'development'
      },
      error_file: './logs/ws-error.log',
      out_file: './logs/ws-out.log',
      autorestart: true
    }
  ]
};