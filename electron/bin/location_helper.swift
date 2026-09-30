import Foundation
import CoreLocation

class LocDelegate: NSObject, CLLocationManagerDelegate {
    let lm = CLLocationManager()
    var finished = false
    
    override init() {
        super.init()
        lm.delegate = self
        lm.desiredAccuracy = kCLLocationAccuracyBest
        lm.startUpdatingLocation()
    }
    
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let loc = locations.last {
            print("{\"lat\":\(loc.coordinate.latitude),\"lng\":\(loc.coordinate.longitude),\"acc\":\(loc.horizontalAccuracy)}")
            finished = true
            exit(0)
        }
    }
    
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        fputs("Error: \(error.localizedDescription)\n", stderr)
        finished = true
        exit(1)
    }
}

let delegate = LocDelegate()
let start = Date()
while !delegate.finished && Date().timeIntervalSince(start) < 4.0 {
    RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.1))
}
exit(1)
