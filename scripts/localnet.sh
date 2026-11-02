#!/bin/zsh
# Local NEAR chain for development: scripts/localnet.sh start | stop | reset | status
# Needs the sandbox node binary; set NEAR_SANDBOX_BIN or run `cargo test -p parley-arena --test sandbox` once to fetch it.
root=${0:A:h:h}
home=$root/.localnet
port=${LOCALNET_PORT:-3030}
bin=${NEAR_SANDBOX_BIN:-$(find $root/target -path '*near-sandbox-*/near-sandbox' -type f 2>/dev/null | head -1)}

running() { [[ -f $home/pid ]] && kill -0 $(<$home/pid) 2>/dev/null }

case $1 in
  start)
    running && { echo "localnet already running on :$port"; exit 0 }
    [[ -x $bin ]] || { echo "sandbox binary not found; set NEAR_SANDBOX_BIN" >&2; exit 1 }
    if [[ ! -f $home/genesis.json ]]; then
      $bin --home $home init --chain-id localnet --account-id test.near >/dev/null 2>&1 || exit 1
    fi
    nohup $bin --home $home run --rpc-addr 127.0.0.1:$port --network-addr 127.0.0.1:$((port + 21000)) > $home/node.log 2>&1 &
    echo $! > $home/pid
    for i in {1..40}; do
      nc -z 127.0.0.1 $port 2>/dev/null && { echo "localnet up on http://127.0.0.1:$port"; exit 0 }
      sleep 0.5
    done
    echo "localnet did not start; see $home/node.log" >&2; exit 1 ;;
  stop)
    running && kill $(<$home/pid) && echo "localnet stopped"
    [[ -f $home/pid ]] && mv $home/pid $home/pid.old; exit 0 ;;
  reset)
    $0 stop
    [[ -d $home ]] && mv $home $root/.localnet-old-$(date +%s)
    $0 start ;;
  status)
    running && echo "running on :$port (pid $(<$home/pid))" || echo "stopped" ;;
  *) echo "usage: localnet.sh start|stop|reset|status" >&2; exit 1 ;;
esac
