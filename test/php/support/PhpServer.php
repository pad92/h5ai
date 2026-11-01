<?php

declare(strict_types=1);

// A `php -S` server on a free local port, running $router for every request.
// Buffered like the Docker image (custom.ini). Its coverage counts through
// SubprocessCoverage, handed back by stop().
final class PhpServer {
    public readonly string $url;
    private $process;

    public function __construct(
        string $router,
        array $env,
        private readonly string $log,
        private readonly SubprocessCoverage $coverage,
    ) {
        $socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
        if ($socket === false) {
            throw new RuntimeException('cannot reserve an HTTP test port: ' . $error);
        }
        $address = stream_socket_get_name($socket, false);
        fclose($socket);
        $this->process = proc_open(
            [PHP_BINARY, ...$coverage->php_arguments(), '-d', 'output_buffering=4096', '-S', $address, $router],
            [0 => ['pipe', 'r'], 1 => ['file', $log, 'a'], 2 => ['file', $log, 'a']],
            $pipes,
            null,
            $env + $coverage->env(),
        );
        if (!is_resource($this->process)) {
            throw new RuntimeException('cannot start the HTTP test server');
        }
        fclose($pipes[0]);
        for ($attempt = 0; $attempt < 100; $attempt++) {
            $connection = @stream_socket_client('tcp://' . $address, $errno, $error, 0.05);
            if ($connection !== false) {
                fclose($connection);
                $this->url = 'http://' . $address . '/';
                return;
            }
            usleep(20000);
        }
        $this->stop();
        throw new RuntimeException('the HTTP test server did not start: ' . @file_get_contents($log));
    }

    public function stop(): void {
        if (is_resource($this->process)) {
            proc_terminate($this->process);
            proc_close($this->process);
            $this->coverage->collect();
        }
    }
}
