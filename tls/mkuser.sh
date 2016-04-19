#!/bin/bash


openssl genrsa -out user$1.key 1024
openssl req -new -key user$1.key -out user$1.csr
openssl x509 -req -in user$1.csr -out user$1.crt -CA ca.crt -CAkey ca.key -CAcreateserial -days 365
openssl x509 -in user$1.crt -text -noout


