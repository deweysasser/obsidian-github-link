.PHONY: build clean

build:
	docker build -o ./build .

clean:
	rm -rf ./build
