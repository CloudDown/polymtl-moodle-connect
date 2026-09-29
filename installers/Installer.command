#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
"$DIR/polymtl-moodle-connect" install
status=$?
if [ "$status" -ne 0 ]; then
  echo "Installation incomplete. Consultez README.md pour obtenir de l'aide."
fi
echo "Appuyez sur Entree pour fermer cette fenetre."
read -r
exit "$status"
