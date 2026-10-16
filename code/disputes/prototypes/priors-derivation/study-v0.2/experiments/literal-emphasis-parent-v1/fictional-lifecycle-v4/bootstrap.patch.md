--- a/actual-entry-v1/bootstrap.mjs
+++ b/actual-entry-v1/bootstrap.mjs
@@ -25,7 +25,9 @@
   // The fixed guardian/result.json path and exit status carry fixture outcome.
   if(result.result.status!=='SOURCE_FREE_FIXTURE_COMPLETE_NOT_ACTUAL_AUTHORIZATION')process.exitCode=2;
 }
+// Finish entry-module evaluation before guardian imports these same exports.
 if(process.argv[1]&&path.resolve(process.argv[1])===SELF){
   if(process.argv.length!==6||process.argv[2]!=='--fictional-config'){process.stderr.write('ACTUAL_ENTRY_CLOSED\n');process.exitCode=2;}
-  else try{await fixtureCLI({path:process.argv[3],sha256:process.argv[4],bytes:Number(process.argv[5])});}catch(error){const code=/^[A-Z0-9_]{1,100}$/u.test(error.code??'')?error.code:'ACTUAL_BOOTSTRAP_HELD';fs.writeSync(2,code+'\n');process.exitCode=2;}
+  else setImmediate(async()=>{try{await fixtureCLI({path:process.argv[3],sha256:process.argv[4],bytes:Number(process.argv[5])});}catch(error){const code=/^[A-Z0-9_]{1,100}$/u.test(error.code??'')?error.code:'ACTUAL_BOOTSTRAP_HELD';fs.writeSync(2,code+'\n');process.exitCode=2;}});
 }
+
