import json
import sys
try:
    import openai
    print(json.dumps({"python": sys.version.split()[0], "openai": openai.__version__, "import": True}))
except ImportError as error:
    print(json.dumps({"import": False, "error": type(error).__name__, "missing_module": error.name}))
    sys.exit(1)
